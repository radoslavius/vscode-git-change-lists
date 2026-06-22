import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import type { GitExtension, Git, Repository, Change } from '../types/git';
import { REFRESH_DEBOUNCE_MS } from '../utils/constants';
import { debounce } from '../utils/helpers';
import { logger } from '../utils/logger';

/**
 * Represents a newly staged file detected by the service
 */
export interface StagedFileChange {
  uri: vscode.Uri;
  isNew: boolean; // true if file was not staged before
}

/**
 * Service for interacting with the Git extension
 */
export class GitService implements vscode.Disposable {
  private gitApi: Git | undefined;
  private repository: Repository | undefined;
  private disposables: vscode.Disposable[] = [];

  private readonly _onDidChangeState = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this._onDidChangeState.event;

  private readonly _onDidStageFiles = new vscode.EventEmitter<StagedFileChange[]>();
  readonly onDidStageFiles = this._onDidStageFiles.event;

  private readonly _onDidCommit = new vscode.EventEmitter<string[]>();
  readonly onDidCommit = this._onDidCommit.event;

  private debouncedEmitChange: () => void;

  // Track previously staged files to detect new staging
  private previouslyStagedFiles = new Set<string>();
  private lastKnownHead: string | undefined;
  private programmaticOperations = new Set<string>();

  constructor() {
    this.debouncedEmitChange = debounce(() => {
      this._onDidChangeState.fire();
    }, REFRESH_DEBOUNCE_MS);
  }

  /**
   * Initialize the Git service and connect to the Git extension
   */
  async initialize(): Promise<boolean> {
    try {
      logger.debug('GitService: Looking for vscode.git extension...');
      const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

      if (!gitExtension) {
        logger.warn('GitService: vscode.git extension not found');
        return false;
      }

      // Wait for the extension to activate
      if (!gitExtension.isActive) {
        logger.debug('GitService: Activating vscode.git extension...');
        await gitExtension.activate();
      }

      const extension = gitExtension.exports;
      if (!extension.enabled) {
        logger.debug('GitService: Waiting for Git to be enabled...');
        // Wait for Git to be enabled
        await new Promise<void>((resolve) => {
          const disposable = extension.onDidChangeEnablement((enabled) => {
            if (enabled) {
              logger.debug('GitService: Git enabled');
              disposable.dispose();
              resolve();
            }
          });
        });
      }

      this.gitApi = extension.getAPI(1);
      logger.debug('GitService: Got Git API (version 1)');

      // Get the first repository
      this.setupRepository();

      // Listen for repository changes
      this.disposables.push(
        this.gitApi.onDidOpenRepository(() => {
          logger.event('GitService', 'Repository opened');
          this.setupRepository();
        }),
        this.gitApi.onDidCloseRepository(() => {
          logger.event('GitService', 'Repository closed');
          this.setupRepository();
        })
      );

      logger.info('GitService: Initialization successful');
      return true;
    } catch (error) {
      logger.error('GitService: Failed to initialize', error);
      return false;
    }
  }

  /**
   * Set up the current repository
   */
  private setupRepository(): void {
    // Clean up previous repository listeners
    this.disposeRepositoryListeners();

    if (!this.gitApi || this.gitApi.repositories.length === 0) {
      logger.debug('GitService: No repositories available');
      this.repository = undefined;
      return;
    }

    // Use the first repository (multi-root support can be added later)
    this.repository = this.gitApi.repositories[0];
    logger.info('GitService: Repository set up', {
      rootUri: this.repository.rootUri.fsPath,
      repositoryCount: this.gitApi.repositories.length,
    });

    // Initialize tracking state
    this.initializeTrackingState();

    // Listen for state changes
    if (this.repository) {
      this.disposables.push(
        this.repository.state.onDidChange(() => {
          this.handleRepositoryStateChange();
          this.debouncedEmitChange();
        })
      );
    }

    this._onDidChangeState.fire();
  }

  /**
   * Initialize tracking state from current repository
   */
  private initializeTrackingState(): void {
    if (!this.repository) {
      return;
    }

    // Track currently staged files
    this.previouslyStagedFiles = new Set(
      this.repository.state.indexChanges.map((c) => c.uri.fsPath)
    );

    // Track current HEAD
    this.lastKnownHead = this.repository.state.HEAD?.commit;
  }

  /**
   * Handle repository state changes to detect staging and commits
   */
  private handleRepositoryStateChange(): void {
    if (!this.repository) {
      return;
    }

    const state = this.repository.state;

    // Check for new staged files
    const currentlyStagedFiles = new Set(
      state.indexChanges.map((c) => c.uri.fsPath)
    );

    const newlyStagedFiles: StagedFileChange[] = [];
    for (const filePath of currentlyStagedFiles) {
      if (!this.previouslyStagedFiles.has(filePath)) {
        if (this.programmaticOperations.has(filePath)) {
          this.programmaticOperations.delete(filePath);
          continue;
        }
        const change = state.indexChanges.find((c) => c.uri.fsPath === filePath);
        if (change) {
          newlyStagedFiles.push({
            uri: change.uri,
            isNew: true,
          });
        }
      }
    }

    if (newlyStagedFiles.length > 0) {
      logger.debug('GitService: New files staged', {
        count: newlyStagedFiles.length,
        files: newlyStagedFiles.map(f => f.uri.fsPath),
      });
      this._onDidStageFiles.fire(newlyStagedFiles);
    }

    // Check for commits (HEAD changed) BEFORE updating previouslyStagedFiles
    const currentHead = state.HEAD?.commit;
    if (currentHead && currentHead !== this.lastKnownHead && this.lastKnownHead) {
      // A commit happened - emit the files that were staged before this change
      const committedFiles = Array.from(this.previouslyStagedFiles);
      logger.debug('GitService: Commit detected', {
        newHead: currentHead.substring(0, 8),
        oldHead: this.lastKnownHead.substring(0, 8),
        committedFileCount: committedFiles.length,
      });
      this._onDidCommit.fire(committedFiles);
    }

    this.previouslyStagedFiles = currentlyStagedFiles;
    this.lastKnownHead = currentHead;
  }

  /**
   * Dispose of repository-specific listeners
   */
  private disposeRepositoryListeners(): void {
    // Disposables are collected in the main array and cleaned up together
  }

  /**
   * Check if a repository is available
   */
  hasRepository(): boolean {
    return this.repository !== undefined;
  }

  /**
   * Get the workspace root URI
   */
  getWorkspaceRoot(): vscode.Uri | undefined {
    return this.repository?.rootUri;
  }

  /**
   * Get currently staged files (index changes)
   */
  getStagedFiles(): Change[] {
    if (!this.repository) {
      return [];
    }
    return [...this.repository.state.indexChanges];
  }

  /**
   * Get all modified files (working tree + index)
   */
  async getModifiedFiles(): Promise<Change[]> {
    if (!this.repository) {
      return [];
    }

    const state = this.repository.state;
    const changes: Change[] = [];

    // Working tree changes (unstaged)
    changes.push(...state.workingTreeChanges);

    // Index changes (staged)
    changes.push(...state.indexChanges);

    // Merge changes (conflicts)
    changes.push(...state.mergeChanges);

    // Deduplicate by URI (prefer working tree over index)
    const seen = new Set<string>();
    const deduped: Change[] = [];

    for (const change of changes) {
      const key = change.uri.fsPath;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(change);
      }
    }

    return deduped;
  }

  /**
   * Stage specific files using git directly
   */
  async stageFiles(uris: vscode.Uri[]): Promise<void> {
    if (!this.repository || uris.length === 0) {
      return;
    }

    const repoRoot = this.repository.rootUri.fsPath;
    const filePaths = uris.map(u => u.fsPath);

    // Track these as programmatic operations to prevent auto-assignment bounce-back
    for (const filePath of filePaths) {
      this.programmaticOperations.add(filePath);
    }

    // Convert to relative paths with forward slashes for Git consistency
    const relativePaths = filePaths.map(p => {
      const rel = path.relative(repoRoot, p);
      return rel.replace(/\\/g, '/');
    });

    logger.debug('GitService: Staging files via git add', {
      count: relativePaths.length,
      repoRoot,
      files: relativePaths,
    });

    // Use git add directly to bypass VS Code Git extension API issues
    await this.runGitCommand(repoRoot, ['add', '--', ...relativePaths]);

    // Refresh repository state to pick up the changes
    await this.repository.status();

    logger.info('GitService: Files staged successfully', { count: relativePaths.length });
  }

  /**
   * Run a git command directly
   */
  private runGitCommand(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      logger.debug('GitService: Running git command', { args, cwd });

      const gitPath = vscode.workspace.getConfiguration('git').get<string>('path') || 'git';
      cp.execFile(gitPath, args, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) {
          logger.error('GitService: Git command failed', {
            args,
            error: error.message,
            stderr,
          });
          reject(new Error(stderr || error.message));
        } else {
          logger.debug('GitService: Git command succeeded', { args });
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Unstage specific files using git directly
   */
  async unstageFiles(uris: vscode.Uri[]): Promise<void> {
    if (!this.repository || uris.length === 0) {
      return;
    }

    const repoRoot = this.repository.rootUri.fsPath;
    const filePaths = uris.map(u => u.fsPath);

    // Track these as programmatic operations to prevent auto-assignment bounce-back
    for (const filePath of filePaths) {
      this.programmaticOperations.add(filePath);
    }

    // Convert to relative paths with forward slashes for Git consistency
    const relativePaths = filePaths.map(p => {
      const rel = path.relative(repoRoot, p);
      return rel.replace(/\\/g, '/');
    });

    logger.debug('GitService: Unstaging files via git reset', {
      count: relativePaths.length,
      repoRoot,
      files: relativePaths,
    });

    // Use git reset HEAD to unstage files
    await this.runGitCommand(repoRoot, ['reset', 'HEAD', '--', ...relativePaths]);

    // Refresh repository state to pick up the changes
    await this.repository.status();

    logger.info('GitService: Files unstaged successfully', { count: relativePaths.length });
  }

  /**
   * Commit staged files
   */
  async commit(message: string): Promise<void> {
    if (!this.repository) {
      throw new Error('No repository available');
    }

    logger.debug('GitService: Committing with message', { message });

    await this.repository.commit(message);
    logger.info('GitService: Commit successful');
  }

  /**
   * Get the diff for a file
   */
  async getDiff(uri: vscode.Uri): Promise<string> {
    if (!this.repository) {
      return '';
    }

    try {
      return await this.repository.diffWithHEAD(uri.fsPath);
    } catch {
      return '';
    }
  }

  /**
   * Apply a patch
   */
  async applyPatch(patch: string): Promise<void> {
    if (!this.repository) {
      throw new Error('No repository available');
    }

    await this.repository.apply(patch);
  }

  /**
   * Get repository input box value
   */
  getInputBoxValue(): string {
    return this.repository?.inputBox.value ?? '';
  }

  /**
   * Set repository input box value
   */
  setInputBoxValue(value: string): void {
    if (this.repository) {
      this.repository.inputBox.value = value;
    }
  }

  /**
   * Create a patch for specific files
   */
  async createPatch(filePaths: string[]): Promise<string> {
    if (!this.repository || filePaths.length === 0) {
      return '';
    }

    const repoRoot = this.repository.rootUri.fsPath;

    // Convert to relative paths with forward slashes for Git consistency
    // Git commands often behave better with relative paths, especially pathspec matching
    const relativePaths = filePaths.map(p => {
      const rel = path.relative(repoRoot, p);
      return rel.replace(/\\/g, '/');
    });

    const untrackedToRestage: string[] = [];

    try {
      // 1. Check for untracked files
      // Use -z to get null-terminated, unquoted paths (handles non-ASCII/spaces correctly)
      const untrackedFilterArgs = ['ls-files', '--others', '--exclude-standard', '-z', '--', ...relativePaths];
      const untrackedOutput = await this.runGitCommand(repoRoot, untrackedFilterArgs);

      const untrackedFiles = untrackedOutput
        .split('\0')
        .filter(s => s.length > 0);

      if (untrackedFiles.length > 0) {
        logger.debug('GitService: Found untracked files, temporarily adding', { count: untrackedFiles.length });

        // Mark them as intent-to-add so they appear in diff
        await this.runGitCommand(repoRoot, ['add', '-N', '--', ...untrackedFiles]);
        untrackedToRestage.push(...untrackedFiles);
      }

      // 2. Generate the diff
      const args = ['diff', 'HEAD', '--', ...relativePaths];
      return await this.runGitCommand(repoRoot, args);

    } finally {
      // 3. Cleanup: Untrack the files we temporarily added
      if (untrackedToRestage.length > 0) {
        try {
          logger.debug('GitService: Restoring untracked state for files', { count: untrackedToRestage.length });
          // "git reset HEAD -- files" removes them from index but keeps workspace content (back to untracked)
          await this.runGitCommand(repoRoot, ['reset', 'HEAD', '--', ...untrackedToRestage]);
        } catch (cleanupError) {
          logger.error('GitService: Failed to revert untracked files', cleanupError);
        }
      }
    }
  }

  /**
   * Refresh repository state
   */
  async refreshRepository(): Promise<void> {
    if (this.repository) {
      await this.repository.status();
    }
  }

  dispose(): void {
    this._onDidChangeState.dispose();
    this._onDidStageFiles.dispose();
    this._onDidCommit.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
