import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ChangeListManager } from './changeListManager';
import { GitService } from './gitService';
import { ConfigService } from './configService';
import { Logger, logger } from '../utils/logger';
import { normalizePathKey } from '../utils/helpers';

/**
 * Service for bi-directional synchronization of change lists with PhpStorm (.idea/workspace.xml)
 */
export class IdeaSyncService implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private xmlFilePath: string | undefined;
  private isWriting = false;
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private writeDebounceTimeout: NodeJS.Timeout | undefined;
  private pollInterval: NodeJS.Timeout | undefined;
  private lastMtime = 0;

  constructor(
    private readonly changeListManager: ChangeListManager,
    private readonly gitService: GitService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Initialize the sync service
   */
  async initialize(): Promise<void> {
    if (!this.configService.getIdeaSyncEnabled()) {
      logger.info('IdeaSyncService: Synchronization is disabled in settings');
      return;
    }

    const workspaceRoot = this.gitService.getWorkspaceRoot();
    if (!workspaceRoot) {
      logger.debug('IdeaSyncService: No workspace root found. Synchronization disabled.');
      return;
    }

    // Path to .idea/workspace.xml
    const ideaPath = path.join(workspaceRoot.fsPath, '.idea');
    this.xmlFilePath = path.join(ideaPath, 'workspace.xml');

    try {
      // Check if folder and file exist
      await fs.access(this.xmlFilePath);
      logger.info(`IdeaSyncService: Found PhpStorm config at ${this.xmlFilePath}`);
    } catch {
      logger.info('IdeaSyncService: .idea/workspace.xml not found. Synchronization disabled.');
      this.xmlFilePath = undefined;
      return;
    }

    // Initial import from PhpStorm to VS Code
    await this.importFromIdea();

    // Watch for external changes to .idea/workspace.xml
    const watcherPattern = new vscode.RelativePattern(ideaPath, 'workspace.xml');
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(watcherPattern);
    
    this.disposables.push(
      this.fileWatcher.onDidChange(async () => {
        if (this.isWriting) {
          logger.info('IdeaSyncService: Ignored file change event (internal write)');
          return;
        }
        logger.info('IdeaSyncService: External change to workspace.xml detected via watcher, importing in 100ms...');
        setTimeout(async () => {
          await this.importFromIdea();
        }, 100);
      }),
      this.fileWatcher.onDidCreate(async () => {
        if (this.isWriting) return;
        logger.info('IdeaSyncService: workspace.xml created via watcher, importing in 100ms...');
        setTimeout(async () => {
          await this.importFromIdea();
        }, 100);
      })
    );

    // Watch for local change list events in VS Code to write back to PhpStorm
    this.disposables.push(
      this.changeListManager.onDidChange((e) => {
        // Skip writing on full refresh (which usually comes from an import or Git checkout)
        if (e.type === 'refresh') {
          return;
        }
        logger.debug(`IdeaSyncService: ChangeList state changed (${e.type}), scheduling write...`);
        this.scheduleExportToIdea();
      })
    );

    // Start polling fallback for UNC/WSL path compatibility
    this.startPolling();

    logger.info('IdeaSyncService: Successfully initialized and watching for changes');
  }

  /**
   * Import change lists and file mappings from PhpStorm's workspace.xml into VS Code
   */
  async importFromIdea(): Promise<void> {
    if (!this.xmlFilePath) return;

    try {
      // Update mtime to prevent polling loop
      try {
        const stats = await fs.stat(this.xmlFilePath);
        this.lastMtime = stats.mtimeMs;
      } catch (err) {
        logger.warn('IdeaSyncService: Failed to stat workspace.xml during import', err);
      }

      const xmlContent = await fs.readFile(this.xmlFilePath, 'utf-8');
      
      // Extract ChangeListManager component
      const componentMatch = xmlContent.match(/<component name="ChangeListManager">([\s\S]*?)<\/component>/);
      if (!componentMatch) {
        logger.debug('IdeaSyncService: ChangeListManager component not found in workspace.xml');
        return;
      }

      const componentContent = componentMatch[1];
      const parsedLists: { id: string; name: string; isDefault: boolean }[] = [];
      const fileMapping: Record<string, string> = {};

      // Match <list> tags (both self-closing and with children)
      // Matches: <list id="..." name="..." ...> ... </list> OR <list id="..." name="..." ... />
      const listRegex = /<list\b([\s\S]*?)(?:>([\s\S]*?)<\/list>|\/>)/g;
      let listMatch;

      while ((listMatch = listRegex.exec(componentContent)) !== null) {
        const attributes = listMatch[1];
        const innerContent = listMatch[2] || '';

        const idMatch = attributes.match(/id="([^"]*)"/);
        const nameMatch = attributes.match(/name="([^"]*)"/);
        const defaultMatch = attributes.match(/default="([^"]*)"/);

        if (!idMatch || !nameMatch) continue;

        const id = idMatch[1];
        const name = nameMatch[1];
        const isDefault = defaultMatch ? defaultMatch[1] === 'true' : false;

        parsedLists.push({ id, name, isDefault });

        // Parse <change> tags in this list to populate fileMapping
        const changeRegex = /<change\b([\s\S]*?)\/>/g;
        let changeMatch;
        const workspaceRoot = this.gitService.getWorkspaceRoot()?.fsPath;

        while (workspaceRoot && (changeMatch = changeRegex.exec(innerContent)) !== null) {
          const changeAttrs = changeMatch[1];
          // Get beforePath or afterPath containing $PROJECT_DIR$/ or $PROJECT_DIR$/
          const pathMatch = changeAttrs.match(/beforePath="\$PROJECT_DIR\$?\/(.*?)"/) || 
                            changeAttrs.match(/afterPath="\$PROJECT_DIR\$?\/(.*?)"/);

          if (pathMatch) {
            const relativePath = pathMatch[1];
            // Combine workspace root and relative path in a platform-independent way
            const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
            const absolutePath = normalizedRoot.endsWith('/')
              ? normalizedRoot + relativePath
              : normalizedRoot + '/' + relativePath;
            fileMapping[normalizePathKey(absolutePath)] = id;
          }
        }
      }

      if (parsedLists.length > 0) {
        logger.info(`IdeaSyncService: Importing ${parsedLists.length} lists and ${Object.keys(fileMapping).length} mappings from PhpStorm`);
        await this.changeListManager.importStateFromIdea(parsedLists, fileMapping);
      }
    } catch (error) {
      logger.error('IdeaSyncService: Failed to import from workspace.xml', error);
    }
  }

  /**
   * Schedule an export to PhpStorm with debouncing
   */
  private scheduleExportToIdea(): void {
    if (this.writeDebounceTimeout) {
      clearTimeout(this.writeDebounceTimeout);
    }

    const interval = this.configService.getIdeaSyncInterval();
    this.writeDebounceTimeout = setTimeout(async () => {
      await this.exportToIdea();
    }, interval);
  }

  /**
   * Export the current VS Code change lists and mappings back to .idea/workspace.xml
   */
  async exportToIdea(): Promise<void> {
    if (!this.xmlFilePath) return;

    this.isWriting = true;
    logger.debug('IdeaSyncService: Starting export to workspace.xml...');

    try {
      const xmlContent = await fs.readFile(this.xmlFilePath, 'utf-8');

      // Generate the new ChangeListManager XML block
      const newBlock = await this.generateXmlBlock();

      const startTag = '<component name="ChangeListManager">';
      const endTag = '</component>';
      const startIndex = xmlContent.indexOf(startTag);
      const endIndex = xmlContent.indexOf(endTag, startIndex);

      if (startIndex !== -1 && endIndex !== -1) {
        const updatedXml = 
          xmlContent.substring(0, startIndex) + 
          newBlock + 
          xmlContent.substring(endIndex + endTag.length);

        await fs.writeFile(this.xmlFilePath, updatedXml, 'utf-8');

        // Update mtime to prevent polling loop
        try {
          const stats = await fs.stat(this.xmlFilePath);
          this.lastMtime = stats.mtimeMs;
        } catch (err) {
          logger.warn('IdeaSyncService: Failed to stat workspace.xml during export', err);
        }

        logger.info('IdeaSyncService: Exported change lists successfully to .idea/workspace.xml');
      } else {
        logger.warn('IdeaSyncService: Could not locate ChangeListManager component in workspace.xml');
      }
    } catch (error) {
      logger.error('IdeaSyncService: Failed to export to workspace.xml', error);
    } finally {
      // Release write lock after a brief timeout to allow OS / VS Code events to settle
      setTimeout(() => {
        this.isWriting = false;
      }, 500);
    }
  }

  /**
   * Generate the XML string for the ChangeListManager component
   */
  private async generateXmlBlock(): Promise<string> {
    const lists = this.changeListManager.getLists().filter(l => !l.isReadOnly);
    const xmlLines: string[] = [];

    xmlLines.push('  <component name="ChangeListManager">');

    for (const list of lists) {
      const defaultAttr = list.isDefault ? ' default="true"' : '';
      const files = await this.changeListManager.getFilesForList(list.id);

      if (files.length === 0) {
        xmlLines.push(`    <list${defaultAttr} id="${list.id}" name="${list.name}" comment="" />`);
      } else {
        xmlLines.push(`    <list${defaultAttr} id="${list.id}" name="${list.name}" comment="">`);
        for (const file of files) {
          // JetBrains uses forward slashes in relative paths
          const relPath = file.relativePath.replace(/\\/g, '/');
          xmlLines.push(`      <change beforePath="$PROJECT_DIR$/${relPath}" beforeDir="false" afterPath="$PROJECT_DIR$/${relPath}" afterDir="false" />`);
        }
        xmlLines.push('    </list>');
      }
    }

    // Preserve standard PhpStorm configuration options inside component
    xmlLines.push('    <option name="SHOW_DIALOG" value="false" />');
    xmlLines.push('    <option name="HIGHLIGHT_CONFLICTS" value="true" />');
    xmlLines.push('    <option name="HIGHLIGHT_NON_ACTIVE_CHANGELIST" value="false" />');
    xmlLines.push('    <option name="LAST_RESOLUTION" value="IGNORE" />');
    xmlLines.push('  </component>');

    return xmlLines.join('\n');
  }

  dispose(): void {
    if (this.writeDebounceTimeout) {
      clearTimeout(this.writeDebounceTimeout);
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    this.disposables.forEach(d => d.dispose());
  }

  /**
   * Start polling fallback for UNC/WSL path compatibility
   */
  private startPolling(): void {
    if (!this.xmlFilePath) return;

    const interval = 2500; // Poll every 2.5 seconds
    this.pollInterval = setInterval(async () => {
      if (this.isWriting) return;

      try {
        const stats = await fs.stat(this.xmlFilePath!);
        const mtime = stats.mtimeMs;
        
        if (this.lastMtime === 0) {
          this.lastMtime = mtime;
        } else if (mtime > this.lastMtime) {
          this.lastMtime = mtime;
          logger.info(`IdeaSyncService: Polling detected external change to workspace.xml (mtime=${mtime}), importing...`);
          await this.importFromIdea();
        }
      } catch (error) {
        logger.warn('IdeaSyncService: Failed to poll workspace.xml stats', error);
      }
    }, interval);
  }
}
