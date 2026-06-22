import * as vscode from 'vscode';
import { CONFIG } from '../utils/constants';
import type { ViewMode } from '../types';

/**
 * Service for managing extension configuration
 */
export class ConfigService {
  /**
   * Get the configuration section
   */
  private getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG.SECTION);
  }

  /**
   * Get the default view mode (list or tree)
   */
  getDefaultViewMode(): ViewMode {
    return this.getConfig().get<ViewMode>(CONFIG.DEFAULT_VIEW_MODE, 'list');
  }

  /**
   * Get whether to show the status bar item
   */
  getShowStatusBar(): boolean {
    return this.getConfig().get<boolean>(CONFIG.SHOW_STATUS_BAR, true);
  }

  /**
   * Get whether to confirm deletion of non-empty lists
   */
  getConfirmDeleteNonEmpty(): boolean {
    return this.getConfig().get<boolean>(CONFIG.CONFIRM_DELETE_NON_EMPTY, true);
  }

  /**
   * Get whether to auto-activate newly created lists
   */
  getAutoActivateNew(): boolean {
    return this.getConfig().get<boolean>(CONFIG.AUTO_ACTIVATE_NEW, true);
  }

  /**
   * Get whether commit guard is enabled
   */
  getCommitGuardEnabled(): boolean {
    return this.getConfig().get<boolean>(CONFIG.COMMIT_GUARD_ENABLED, true);
  }

  /**
   * Get whether to intercept the native commit command
   */
  getInterceptCommit(): boolean {
    return this.getConfig().get<boolean>(CONFIG.INTERCEPT_COMMIT, false);
  }

  /**
   * Get whether to auto-assign externally staged files to active list
   */
  getAutoAssignStagedFiles(): boolean {
    return this.getConfig().get<boolean>(CONFIG.AUTO_ASSIGN_STAGED, true);
  }

  /**
   * Get whether debug logging is enabled
   */
  getDebugLoggingEnabled(): boolean {
    return this.getConfig().get<boolean>(CONFIG.DEBUG_LOGGING, false);
  }

  /**
   * Get whether PhpStorm sync is enabled
   */
  getIdeaSyncEnabled(): boolean {
    return this.getConfig().get<boolean>(CONFIG.IDEA_SYNC_ENABLED, true);
  }

  /**
   * Get PhpStorm sync interval in milliseconds
   */
  getIdeaSyncInterval(): number {
    return this.getConfig().get<number>(CONFIG.IDEA_SYNC_INTERVAL, 1000);
  }

  /**
   * Listen for configuration changes
   */
  onDidChangeConfiguration(
    callback: (e: vscode.ConfigurationChangeEvent) => void
  ): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG.SECTION)) {
        callback(e);
      }
    });
  }
}
