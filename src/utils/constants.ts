/**
 * Extension constants
 */

/** Extension identifier */
export const EXTENSION_ID = 'git-change-lists';

/** View identifiers */
export const VIEW_ID = 'gitChangeLists.changeLists';

/** Command identifiers */
export const COMMANDS = {
  CREATE_LIST: 'gitChangeLists.createList',
  DELETE_LIST: 'gitChangeLists.deleteList',
  RENAME_LIST: 'gitChangeLists.renameList',
  SET_ACTIVE_LIST: 'gitChangeLists.setActiveList',
  MOVE_TO_LIST: 'gitChangeLists.moveToList',
  COMMIT_LIST: 'gitChangeLists.commitList',
  STAGE_LIST: 'gitChangeLists.stageList',
  TOGGLE_VIEW_MODE: 'gitChangeLists.toggleViewMode',
  APPLY_PATCH: 'gitChangeLists.applyPatch',
  CREATE_PATCH: 'gitChangeLists.createPatch',
  REFRESH: 'gitChangeLists.refresh',
  GUARDED_COMMIT: 'gitChangeLists.guardedCommit',
  SET_LIST_COLOR: 'gitChangeLists.setListColor',
} as const;

/** Configuration keys */
export const CONFIG = {
  SECTION: 'gitChangeLists',
  DEFAULT_VIEW_MODE: 'defaultViewMode',
  SHOW_STATUS_BAR: 'showStatusBar',
  CONFIRM_DELETE_NON_EMPTY: 'confirmDeleteNonEmpty',
  AUTO_ACTIVATE_NEW: 'autoActivateNew',
  COMMIT_GUARD_ENABLED: 'commitGuard.enabled',
  INTERCEPT_COMMIT: 'commitGuard.interceptCommit',
  AUTO_ASSIGN_STAGED: 'autoAssignStagedFiles',
  DEBUG_LOGGING: 'debug.enableLogging',
  IDEA_SYNC_ENABLED: 'ideaSync.enabled',
  IDEA_SYNC_INTERVAL: 'ideaSync.interval',
} as const;

/** Storage keys */
export const STORAGE_KEYS = {
  CHANGE_LIST_STATE: 'gitChangeLists.changeListState',
  VIEW_MODE: 'gitChangeLists.viewMode',
  EXPANSION_STATE: 'gitChangeLists.expansionState',
} as const;

/** Context keys for when clauses */
export const CONTEXT_KEYS = {
  LIST_IS_DEFAULT: 'listIsDefault',
  LIST_IS_ACTIVE: 'listIsActive',
  HAS_CHANGES: 'gitChangeLists.hasChanges',
} as const;

/** Default change list name */
export const DEFAULT_LIST_NAME = 'Default';

/** Unversioned files list ID */
export const UNVERSIONED_LIST_ID = 'virtual-unversioned-files-list';

/** Current schema version for state persistence */
export const STATE_SCHEMA_VERSION = 1;

/** Debounce delay for refresh operations (ms) */
export const REFRESH_DEBOUNCE_MS = 150;

/** MIME type for drag and drop operations */
export const DRAG_MIME_TYPE = 'application/vnd.code.tree.gitchangelists.changelists';

/** Tree item context values */
export const CONTEXT_VALUES = {
  CHANGE_LIST: 'changeList',
  CHANGE_LIST_DEFAULT: 'changeListDefault',
  CHANGE_LIST_ACTIVE: 'changeListActive',
  CHANGE_LIST_READONLY: 'changeListReadOnly',
  DIRECTORY: 'changeListDirectory',
  FILE: 'changeListFile',
} as const;
