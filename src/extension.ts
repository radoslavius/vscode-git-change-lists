import * as vscode from 'vscode';
import { ChangeListManager } from './services/changeListManager';
import { GitService } from './services/gitService';
import { ConfigService } from './services/configService';
import { CommitGuardService } from './services/commitGuardService';
import { PatchService } from './services/patchService';
import { ChangeListTreeDataProvider } from './providers/treeDataProvider';
import { ChangeListDragDropController } from './providers/dragDropController';
import { registerCommands } from './commands';
import { VIEW_ID } from './utils/constants';
import { logger } from './utils/logger';
import { IdeaSyncService } from './services/ideaSyncService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Register logger output channel
  context.subscriptions.push(logger.getOutputChannel());

  logger.info('Activating Git Change Lists extension...');

  try {
    // Initialize services
    const configService = new ConfigService();

    // Enable debug logging based on configuration
    logger.setDebugEnabled(configService.getDebugLoggingEnabled());

    const gitService = new GitService();

    // Wait for Git extension to be ready
    logger.debug('Initializing Git service...');
    const gitReady = await gitService.initialize();
    if (!gitReady) {
      logger.warn('Git extension not available. Extension will activate when a repository is opened.');
    } else {
      logger.info('Git service initialized successfully');
    }

    // Initialize change list manager with workspace state
    logger.debug('Initializing change list manager...');
    const changeListManager = new ChangeListManager(context.workspaceState, gitService);
    await changeListManager.initialize();
    logger.info(`Change list manager initialized with ${changeListManager.getLists().length} lists`);

    // Initialize Patch Service
    logger.debug('Initializing patch service...');
    const patchService = new PatchService(changeListManager, gitService);

    // Create tree data provider
    logger.debug('Creating tree data provider...');
    const treeDataProvider = new ChangeListTreeDataProvider(
      changeListManager,
      gitService,
      configService
    );

    // Create drag and drop controller
    logger.debug('Creating drag and drop controller...');
    const dragDropController = new ChangeListDragDropController(changeListManager, treeDataProvider);

    // Create tree view
    logger.debug('Creating tree view...');
    const treeView = vscode.window.createTreeView(VIEW_ID, {
      treeDataProvider,
      showCollapseAll: true,
      canSelectMany: true,
      dragAndDropController: dragDropController,
    });
    context.subscriptions.push(treeView);

    // Register commands
    logger.debug('Registering commands...');
    const commandDisposables = registerCommands(
      changeListManager,
      gitService,
      configService,
      patchService,
      treeDataProvider,
      treeView
    );
    context.subscriptions.push(...commandDisposables);

    // Initialize commit guard service
    logger.debug('Initializing commit guard service...');
    const commitGuardService = new CommitGuardService(
      changeListManager,
      gitService,
      configService
    );
    commitGuardService.initialize();
    logger.info('Commit guard service initialized');

    // Initialize PhpStorm sync service
    logger.debug('Initializing PhpStorm sync service...');
    const ideaSyncService = new IdeaSyncService(
      changeListManager,
      gitService,
      configService
    );
    await ideaSyncService.initialize();

    // Create and integrate Status Bar Item
    logger.debug('Creating status bar item...');
    let statusBarItem: vscode.StatusBarItem | undefined;

    const updateStatusBar = () => {
      if (!configService.getShowStatusBar() || !gitService.hasRepository()) {
        if (statusBarItem) {
          statusBarItem.hide();
        }
        return;
      }

      const activeList = changeListManager.getActiveList();
      if (!activeList) {
        if (statusBarItem) {
          statusBarItem.hide();
        }
        return;
      }

      if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(
          vscode.StatusBarAlignment.Left,
          100
        );
        statusBarItem.command = 'gitChangeLists.setActiveList';
        context.subscriptions.push(statusBarItem);
      }

      statusBarItem.text = `$(git-branch) Change List: ${activeList.name}`;
      statusBarItem.tooltip = `Active Change List: ${activeList.name}\nClick to switch active change list`;
      statusBarItem.show();
    };

    // Update status bar initially
    updateStatusBar();

    // Subscribe to Git state changes
    logger.debug('Setting up event listeners...');
    gitService.onDidChangeState(() => {
      logger.event('Git', 'State changed');
      treeDataProvider.refresh();
      updateStatusBar();
    });

    // Subscribe to externally staged files (auto-assignment)
    gitService.onDidStageFiles(async (stagedFiles) => {
      logger.event('Git', 'Files staged', { count: stagedFiles.length, files: stagedFiles.map(f => f.uri.fsPath) });

      if (!configService.getAutoAssignStagedFiles()) {
        logger.debug('Auto-assign staged files is disabled');
        return;
      }

      const activeList = changeListManager.getActiveList();
      if (!activeList) {
        logger.warn('No active list found for auto-assignment');
        return;
      }

      logger.debug(`Auto-assignment: Active list is "${activeList.name}"`);

      for (const staged of stagedFiles) {
        if (staged.isNew) {
          // Check if this file is already assigned to a list
          const existingList = changeListManager.getListForFile(staged.uri.fsPath);
          // Only auto-assign if the file is currently in the default list
          // (meaning it wasn't explicitly moved somewhere)
          const defaultList = changeListManager.getDefaultList();
          if (existingList.id === defaultList.id && activeList.id !== defaultList.id) {
            await changeListManager.assignFile(staged.uri.fsPath, activeList.id);
            logger.info(`Auto-assigned file to active list`, {
              file: staged.uri.fsPath,
              list: activeList.name,
            });
          } else {
            logger.debug(`Skipped auto-assignment`, {
              file: staged.uri.fsPath,
              reason: existingList.id !== defaultList.id ? 'already assigned to non-default list' : 'active list is default',
            });
          }
        }
      }
    });

    // Subscribe to commits (post-commit cleanup)
    gitService.onDidCommit(async (committedFiles) => {
      logger.event('Git', 'Commit detected', { fileCount: committedFiles.length });

      // Remove committed files from change list tracking
      await changeListManager.removeFileMappings(committedFiles);
      logger.info(`Post-commit cleanup completed`, { removedFiles: committedFiles.length });
    });

    // Subscribe to change list state changes
    changeListManager.onDidChange((event) => {
      logger.event('ChangeList', 'State changed', event);
      treeDataProvider.refresh();
      updateStatusBar();
    });

    // Subscribe to configuration changes
    configService.onDidChangeConfiguration((e) => {
      logger.event('Config', 'Configuration changed');

      // Update debug logging if that setting changed
      if (e.affectsConfiguration('gitChangeLists.debug.enableLogging')) {
        const newValue = configService.getDebugLoggingEnabled();
        logger.setDebugEnabled(newValue);
      }

      treeDataProvider.refresh();
      updateStatusBar();
    });

    // Add services to subscriptions for cleanup
    context.subscriptions.push(
      changeListManager,
      gitService,
      commitGuardService,
      treeDataProvider,
      ideaSyncService
    );

    logger.info('Git Change Lists extension activated successfully!');
  } catch (error) {
    logger.error('Failed to activate extension', error);
    vscode.window.showErrorMessage(`Git Change Lists failed to activate: ${error}`);
  }
}

export function deactivate(): void {
  logger.info('Git Change Lists extension deactivated');
  logger.dispose();
}
