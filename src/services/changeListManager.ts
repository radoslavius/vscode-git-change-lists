import * as vscode from 'vscode';
import {
  ChangeList,
  ChangeListState,
  ChangeListChangeEvent,
  TrackedChange,
  GitFileStatus,
} from '../types';
import { GitService } from './gitService';
import {
  STORAGE_KEYS,
  STATE_SCHEMA_VERSION,
  DEFAULT_LIST_NAME,
  UNVERSIONED_LIST_ID,
} from '../utils/constants';
import { generateId, now, getRelativePath, normalizePathKey } from '../utils/helpers';
import { logger } from '../utils/logger';

/**
 * Manages change list state and operations
 */
export class ChangeListManager implements vscode.Disposable {
  private state: ChangeListState;
  private readonly _onDidChange = new vscode.EventEmitter<ChangeListChangeEvent>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly gitService: GitService
  ) {
    this.state = this.createInitialState();
  }

  /**
   * Initialize the manager and restore state
   */
  async initialize(): Promise<void> {
    logger.debug('ChangeListManager: Initializing...');
    const savedState = this.workspaceState.get<ChangeListState>(STORAGE_KEYS.CHANGE_LIST_STATE);

    if (savedState) {
      logger.debug('ChangeListManager: Restoring saved state', {
        version: savedState.version,
        listCount: savedState.lists.length,
        fileMappingCount: Object.keys(savedState.fileMapping).length,
      });
      // Validate and migrate if needed
      this.state = this.migrateState(savedState);
    } else {
      logger.debug('ChangeListManager: No saved state, creating initial state');
      this.state = this.createInitialState();
    }

    // Ensure default list exists
    this.ensureDefaultList();

    logger.info('ChangeListManager: Initialized', {
      listCount: this.state.lists.length,
      activeList: this.getActiveList()?.name,
    });
  }

  /**
   * Create initial state with default change list
   */
  private createInitialState(): ChangeListState {
    const defaultList = this.createDefaultList();
    return {
      version: STATE_SCHEMA_VERSION,
      lists: [defaultList],
      fileMapping: {},
    };
  }

  /**
   * Create the default change list
   */
  private createDefaultList(): ChangeList {
    const timestamp = now();
    return {
      id: generateId(),
      name: DEFAULT_LIST_NAME,
      isActive: true,
      isDefault: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /**
   * Ensure default list exists
   */
  private ensureDefaultList(): void {
    const hasDefault = this.state.lists.some((list) => list.isDefault);
    if (!hasDefault) {
      this.state.lists.unshift(this.createDefaultList());
    }

    // Ensure exactly one list is active
    const activeCount = this.state.lists.filter((list) => list.isActive).length;
    if (activeCount === 0) {
      const defaultList = this.state.lists.find((list) => list.isDefault);
      if (defaultList) {
        defaultList.isActive = true;
      }
    } else if (activeCount > 1) {
      // Keep only the first active list as active
      let foundActive = false;
      for (const list of this.state.lists) {
        if (list.isActive) {
          if (foundActive) {
            list.isActive = false;
          } else {
            foundActive = true;
          }
        }
      }
    }
  }

  /**
   * Migrate state from older versions
   */
  private migrateState(savedState: ChangeListState): ChangeListState {
    // Currently at version 1, no migrations needed
    if (!savedState.version || savedState.version < STATE_SCHEMA_VERSION) {
      // Future migrations would go here
    }
    return {
      ...savedState,
      version: STATE_SCHEMA_VERSION,
    };
  }

  /**
   * Remove file mappings for files that are no longer modified
   */
  private async cleanupStaleFileMappings(): Promise<void> {
    const modifiedFiles = await this.gitService.getModifiedFiles();
    const modifiedPaths = new Set(modifiedFiles.map((f) => normalizePathKey(f.uri.fsPath)));

    const staleFiles: string[] = [];
    for (const filePath of Object.keys(this.state.fileMapping)) {
      if (!modifiedPaths.has(filePath)) {
        staleFiles.push(filePath);
      }
    }

    if (staleFiles.length > 0) {
      for (const filePath of staleFiles) {
        delete this.state.fileMapping[filePath];
      }
      await this.persistState();
    }
  }

  /**
   * Persist state to workspace storage
   */
  private async persistState(): Promise<void> {
    await this.workspaceState.update(STORAGE_KEYS.CHANGE_LIST_STATE, this.state);
  }

  /**
   * Get all change lists
   */
  getLists(): readonly ChangeList[] {
    const virtualList: ChangeList = {
      id: UNVERSIONED_LIST_ID,
      name: 'Unversioned Files',
      description: 'Files not yet tracked by Git',
      isActive: false,
      isDefault: false,
      isReadOnly: true,
      createdAt: 0,
      updatedAt: 0,
      color: 'charts.orange',
    };
    return [...this.state.lists, virtualList];
  }

  /**
   * Get a change list by ID
   */
  getList(id: string): ChangeList | undefined {
    if (id === UNVERSIONED_LIST_ID) {
      return this.getLists().find(l => l.id === UNVERSIONED_LIST_ID);
    }
    return this.state.lists.find((list) => list.id === id);
  }

  /**
   * Get the active change list
   */
  getActiveList(): ChangeList | undefined {
    return this.state.lists.find((list) => list.isActive);
  }

  /**
   * Get the default change list
   */
  getDefaultList(): ChangeList {
    const defaultList = this.state.lists.find((list) => list.isDefault);
    if (!defaultList) {
      throw new Error('Default list not found');
    }
    return defaultList;
  }

  /**
   * Create a new change list
   */
  async create(name: string, description?: string, color?: string, setActive = true): Promise<ChangeList> {
    logger.debug('ChangeListManager: Creating new list', { name, description, color, setActive });

    // Validate name uniqueness
    if (this.state.lists.some((list) => list.name === name)) {
      const error = `A change list named "${name}" already exists`;
      logger.warn('ChangeListManager: Create failed - duplicate name', { name });
      throw new Error(error);
    }

    const timestamp = now();
    const newList: ChangeList = {
      id: generateId(),
      name,
      description,
      color,
      isActive: false,
      isDefault: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.state.lists.push(newList);

    if (setActive) {
      this.setActiveInternal(newList.id);
    }

    await this.persistState();
    this._onDidChange.fire({ type: 'created', changeListId: newList.id });

    logger.info('ChangeListManager: Created new list', { id: newList.id, name: newList.name });
    return newList;
  }

  /**
   * Rename a change list
   */
  async rename(id: string, newName: string): Promise<void> {
    if (id === UNVERSIONED_LIST_ID) {
      throw new Error('Cannot rename the Unversioned Files list');
    }
    const list = this.getList(id);
    if (!list) {
      throw new Error('Change list not found');
    }

    // Validate name uniqueness
    if (this.state.lists.some((l) => l.id !== id && l.name === newName)) {
      throw new Error(`A change list named "${newName}" already exists`);
    }

    list.name = newName;
    list.updatedAt = now();

    await this.persistState();
    this._onDidChange.fire({ type: 'renamed', changeListId: id });
  }

  /**
   * Set the color of a change list
   */
  async setColor(id: string, color: string | undefined): Promise<void> {
    const list = this.getList(id);
    if (!list) {
      throw new Error('Change list not found');
    }

    list.color = color;
    list.updatedAt = now();

    await this.persistState();
    this._onDidChange.fire({ type: 'renamed', changeListId: id }); // 'renamed' triggers a refresh which is enough for now, or add 'updated' type
  }

  /**
   * Delete a change list
   */
  async delete(id: string): Promise<void> {
    if (id === UNVERSIONED_LIST_ID) {
      throw new Error('Cannot delete the Unversioned Files list');
    }
    const list = this.getList(id);
    if (!list) {
      throw new Error('Change list not found');
    }

    if (list.isDefault) {
      throw new Error('Cannot delete the default change list');
    }

    // Move files back to default list
    const defaultList = this.getDefaultList();
    const filesToMove: string[] = [];

    for (const [filePath, listId] of Object.entries(this.state.fileMapping)) {
      if (listId === id) {
        this.state.fileMapping[filePath] = defaultList.id;
        filesToMove.push(filePath);
      }
    }

    // If deleted list was active, activate default list
    if (list.isActive) {
      defaultList.isActive = true;
    }

    // Remove the list
    const index = this.state.lists.findIndex((l) => l.id === id);
    this.state.lists.splice(index, 1);

    await this.persistState();
    this._onDidChange.fire({ type: 'deleted', changeListId: id, affectedFiles: filesToMove });
  }

  /**
   * Set a change list as active
   */
  async setActive(id: string): Promise<void> {
    this.setActiveInternal(id);
    await this.persistState();
    this._onDidChange.fire({ type: 'activated', changeListId: id });
  }

  /**
   * Internal method to set active list
   */
  private setActiveInternal(id: string): void {
    const list = this.getList(id);
    if (!list) {
      throw new Error('Change list not found');
    }

    // Deactivate all other lists
    for (const l of this.state.lists) {
      l.isActive = l.id === id;
    }
  }

  /**
   * Get the change list ID for a file
   */
  getListIdForFile(filePath: string): string {
    const key = normalizePathKey(filePath);
    return this.state.fileMapping[key] ?? this.getDefaultList().id;
  }

  /**
   * Get the change list for a file
   */
  getListForFile(filePath: string): ChangeList {
    const listId = this.getListIdForFile(filePath);
    return this.getList(listId) ?? this.getDefaultList();
  }

  /**
   * Assign a file to a change list
   */
  async assignFile(filePath: string, listId: string): Promise<void> {
    const list = this.getList(listId);
    if (!list) {
      throw new Error('Change list not found');
    }

    const key = normalizePathKey(filePath);
    this.state.fileMapping[key] = listId;
    await this.persistState();
    this._onDidChange.fire({ type: 'filesMoved', changeListId: listId, affectedFiles: [filePath] });
  }

  /**
   * Move files to a different change list
   */
  async moveFiles(filePaths: string[], targetListId: string): Promise<void> {
    const list = this.getList(targetListId);
    if (!list) {
      throw new Error('Change list not found');
    }

    logger.debug('ChangeListManager: Moving files', {
      count: filePaths.length,
      targetList: list.name,
      files: filePaths,
    });

    // Handle moves to Unversioned Files list (unstage files)
    if (targetListId === UNVERSIONED_LIST_ID) {
      const uris = filePaths.map((p) => vscode.Uri.file(p));
      try {
        await this.gitService.unstageFiles(uris);

        // Remove from file mapping so they fall back to being untracked (which getFilesForList handles)
        for (const filePath of filePaths) {
          const key = normalizePathKey(filePath);
          delete this.state.fileMapping[key];
        }
      } catch (error) {
        logger.error('ChangeListManager: Failed to unstage files', error);
        throw error;
      }
    } else {
      // Handle moves to regular lists
      const filesToStage: string[] = [];

      for (const filePath of filePaths) {
        // Update mapping
        const key = normalizePathKey(filePath);
        this.state.fileMapping[key] = targetListId;

        // Check if file is currently untracked (via git status)
        // We'll need to check the actual status from GitService or assume based on current list
        // Best to check if we can stage it. 
        // Simple approach: Always try to stage if we are moving to a tracked list.
        // But we should only stage if it's untracked or modified? 
        // Actually, 'git add' is safe for modified/added/untracked.
        filesToStage.push(filePath);
      }

      if (filesToStage.length > 0) {
        const uris = filesToStage.map((p) => vscode.Uri.file(p));
        try {
          await this.gitService.stageFiles(uris);
        } catch (error) {
          logger.error('ChangeListManager: Failed to stage files', error);
          // We continue even if staging fails, as the list assignment is internal state too
          // But user expects it to be staged. 
          // If it fails, maybe we shouldn't update the mapping?
          // For now, let's throw to indicate partial failure
          throw error;
        }
      }
    }

    await this.persistState();
    this._onDidChange.fire({ type: 'filesMoved', changeListId: targetListId, affectedFiles: filePaths });

    logger.info('ChangeListManager: Files moved', {
      count: filePaths.length,
      targetList: list.name,
    });
  }

  /**
   * Get all files in a change list
   */
  async getFilesForList(listId: string): Promise<TrackedChange[]> {
    const modifiedFiles = await this.gitService.getModifiedFiles();
    const workspaceRoot = this.gitService.getWorkspaceRoot();

    return modifiedFiles
      .filter((change) => {
        const isUntracked = this.mapGitStatus(change.status) === GitFileStatus.Untracked;

        if (listId === UNVERSIONED_LIST_ID) {
          return isUntracked;
        }

        // For other lists, exclude untracked files
        if (isUntracked) {
          return false;
        }

        return this.getListIdForFile(change.uri.fsPath) === listId;
      })
      .map((change) => ({
        resourceUri: change.uri,
        relativePath: workspaceRoot
          ? getRelativePath(change.uri, workspaceRoot)
          : change.uri.fsPath,
        changeListId: listId,
        gitStatus: this.mapGitStatus(change.status),
        originalUri: change.originalUri,
      }));
  }

  /**
   * Get file count for a change list
   */
  async getFileCountForList(listId: string): Promise<number> {
    const files = await this.getFilesForList(listId);
    return files.length;
  }

  /**
   * Map Git status to our enum
   */
  private mapGitStatus(status: number): GitFileStatus {
    // Status values from vscode.git extension
    switch (status) {
      case 0: // INDEX_MODIFIED
      case 5: // MODIFIED
        return GitFileStatus.Modified;
      case 1: // INDEX_ADDED
        return GitFileStatus.Added;
      case 2: // INDEX_DELETED
      case 6: // DELETED
        return GitFileStatus.Deleted;
      case 3: // INDEX_RENAMED
        return GitFileStatus.Renamed;
      case 4: // INDEX_COPIED
        return GitFileStatus.Copied;
      case 7: // UNTRACKED
        return GitFileStatus.Untracked;
      case 8: // IGNORED
        return GitFileStatus.Ignored;
      default:
        // Conflict states
        if (status >= 11 && status <= 17) {
          return GitFileStatus.Conflict;
        }
        return GitFileStatus.Modified;
    }
  }

  /**
   * Remove a file from all mappings (after commit)
   */
  async removeFileMappings(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      const key = normalizePathKey(filePath);
      delete this.state.fileMapping[key];
    }
    await this.persistState();
    this._onDidChange.fire({ type: 'refresh' });
  }

  /**
   * Import change lists and file mappings from PhpStorm/Idea configuration
   */
  async importStateFromIdea(
    lists: { id: string; name: string; isDefault: boolean }[],
    fileMapping: Record<string, string>
  ): Promise<void> {
    logger.debug('ChangeListManager: Importing state from PhpStorm', {
      listCount: lists.length,
      mappingCount: Object.keys(fileMapping).length,
    });

    const timestamp = now();
    const updatedLists = lists.map((l) => {
      const existing = this.state.lists.find((el) => el.id === l.id);
      return {
        id: l.id,
        name: l.name,
        isDefault: l.isDefault,
        isActive: existing ? existing.isActive : l.isDefault,
        createdAt: existing ? existing.createdAt : timestamp,
        updatedAt: timestamp,
        description: existing ? existing.description : undefined,
        color: existing ? existing.color : undefined,
      };
    });

    // Ensure at least one list is active
    if (!updatedLists.some((l) => l.isActive)) {
      const defaultList = updatedLists.find((l) => l.isDefault);
      if (defaultList) {
        defaultList.isActive = true;
      } else if (updatedLists.length > 0) {
        updatedLists[0].isActive = true;
      }
    }

    this.state.lists = updatedLists;
    
    // Normalize mapping keys
    const normalizedMapping: Record<string, string> = {};
    for (const [filePath, listId] of Object.entries(fileMapping)) {
      normalizedMapping[normalizePathKey(filePath)] = listId;
    }
    this.state.fileMapping = normalizedMapping;

    await this.persistState();
    this._onDidChange.fire({ type: 'refresh' });
  }

  /**
   * Refresh state (e.g., after Git operations)
   */
  async refresh(): Promise<void> {
    await this.cleanupStaleFileMappings();
    this._onDidChange.fire({ type: 'refresh' });
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
