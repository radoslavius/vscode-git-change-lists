# Smart Commit Configuration

Complete reference for all configuration settings in Smart Commit v1.0.0.

---

## Table of Contents

- [Configuration Overview](#configuration-overview)
- [All Settings](#all-settings)
- [Setting Details](#setting-details)
- [Configuration Examples](#configuration-examples)
- [Recommended Configurations](#recommended-configurations)
- [Workspace vs Global Settings](#workspace-vs-global-settings)
- [Troubleshooting Configuration](#troubleshooting-configuration)

---

## Configuration Overview

Smart Commit can be configured through VS Code's settings UI or by editing `settings.json` directly.

### Access Settings

#### Via Settings UI

1. Open Settings: `Ctrl+,` (or `Cmd+,` on Mac)
2. Search for "Smart Commit"
3. Modify settings with checkboxes and dropdowns

#### Via settings.json

1. Open Command Palette: `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Run: `Preferences: Open Settings (JSON)`
3. Add Smart Commit settings under the root object

### Setting Namespace

All Smart Commit settings are prefixed with `smartCommit.`:

```json
{
  "smartCommit.defaultViewMode": "list",
  "smartCommit.showStatusBar": true
}
```

---

## All Settings

Quick reference table of all available settings:

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `smartCommit.defaultViewMode` | `"list"` \| `"tree"` | `"list"` | Workspace | Default view mode for file display |
| `smartCommit.showStatusBar` | `boolean` | `true` | Global | Show active list in status bar |
| `smartCommit.confirmDeleteNonEmpty` | `boolean` | `true` | Global | Confirm before deleting non-empty lists |
| `smartCommit.autoActivateNew` | `boolean` | `true` | Global | Auto-activate newly created lists |
| `smartCommit.commitGuard.enabled` | `boolean` | `true` | Global | Warn when staging mixed change lists |
| `smartCommit.commitGuard.interceptCommit` | `boolean` | `false` | Global | Intercept native commit command |
| `smartCommit.autoAssignStagedFiles` | `boolean` | `true` | Global | Auto-assign externally staged files |
| `gitChangeLists.ideaSync.enabled` | `boolean` | `true` | Workspace | Enable PhpStorm bi-directional synchronization |
| `gitChangeLists.ideaSync.interval` | `integer` | `1000` | Global | Debounce interval (in ms) for PhpStorm sync |
| `smartCommit.debug.enableLogging` | `boolean` | `true` | Global | Enable verbose debug logging |

---

## Setting Details

### View and Display

#### `smartCommit.defaultViewMode`

**Type:** `"list"` | `"tree"`
**Default:** `"list"`
**Scope:** Workspace
**Restart Required:** No

**Description:**
Determines the initial view mode when opening a workspace or creating a change list.

**Values:**
- `"list"`: Flat view showing all files directly under each change list
- `"tree"`: Hierarchical view preserving project directory structure

**Behavior:**
- Only affects the *default* mode on first view
- Users can toggle between modes anytime
- View mode choice is persisted per workspace
- Each workspace can have a different default

**Example:**

```json
{
  "smartCommit.defaultViewMode": "tree"
}
```

**When to Use:**
- Use `"list"` for small projects with few directories
- Use `"tree"` for large projects with deep folder structures
- Set per-workspace based on project complexity

---

#### `smartCommit.showStatusBar`

**Type:** `boolean`
**Default:** `true`
**Scope:** Global
**Restart Required:** No

**Description:**
Controls visibility of the active change list indicator in the status bar.

**When `true`:**
- Status bar shows the active change list name (e.g., `[Feature A]`)
- Click to open quick-pick for switching lists
- Tooltip shows full name if truncated

**When `false`:**
- Status bar item is hidden
- Active list can still be changed via context menu or keybinding

**Example:**

```json
{
  "smartCommit.showStatusBar": false
}
```

**When to Disable:**
- Minimal status bar preference
- Workspace with only one change list (Default)
- Using external monitoring tools

---

### Confirmations and Safety

#### `smartCommit.confirmDeleteNonEmpty`

**Type:** `boolean`
**Default:** `true`
**Scope:** Global
**Restart Required:** No

**Description:**
Asks for confirmation before deleting a change list that contains files.

**When `true`:**
- Deleting a non-empty list shows a confirmation dialog
- Dialog includes file count and options to proceed or cancel
- Prevents accidental deletion of organized work

**When `false`:**
- Lists are deleted immediately without confirmation
- Files are reassigned to Default list
- Faster workflow for experienced users

**Example:**

```json
{
  "smartCommit.confirmDeleteNonEmpty": false
}
```

**When to Disable:**
- You're confident in your delete operations
- You frequently reorganize and delete lists
- You want a faster workflow

**Note:** Empty lists never prompt for confirmation, regardless of this setting.

---

### Automation

#### `smartCommit.autoActivateNew`

**Type:** `boolean`
**Default:** `true`
**Scope:** Global
**Restart Required:** No

**Description:**
Automatically sets newly created change lists as active.

**When `true`:**
- Creating a new list immediately sets it as active
- New changes automatically go to the new list
- Streamlines workflow when starting new tasks

**When `false`:**
- Newly created lists are inactive by default
- User must manually set the list as active
- Default list remains active

**Example:**

```json
{
  "smartCommit.autoActivateNew": false
}
```

**When to Disable:**
- You create lists for future use (not immediate work)
- You prefer explicit active list control
- You frequently create "parking lot" lists

**Workflow Comparison:**

**With `autoActivateNew: true`:**
1. Create "Feature X" list
2. It becomes active automatically
3. Start coding, files go to "Feature X"

**With `autoActivateNew: false`:**
1. Create "Feature X" list
2. It remains inactive
3. Manually set it as active when ready
4. Start coding, files go to "Feature X"

---

#### `smartCommit.autoAssignStagedFiles`

**Type:** `boolean`
**Default:** `true`
**Scope:** Global
**Restart Required:** No

**Description:**
Automatically assigns externally staged files to the active change list.

**When `true`:**
- Files staged via command line, file explorer, or other extensions are assigned to the active list
- Keeps change lists synchronized with Git operations
- Maintains organization consistency

**When `false`:**
- Externally staged files are not assigned to any list
- They appear in the Default list
- Manual reassignment required

**Example:**

```json
{
  "smartCommit.autoAssignStagedFiles": false
}
```

**External Staging Examples:**
- Command line: `git add src/app.ts`
- File explorer: Right-click → Stage Changes
- Another extension's staging command
- Bulk stage operations

**When to Disable:**
- You rarely use external Git tools
- You prefer manual control over all assignments
- You have complex staging workflows

---

### Commit Guard

#### `smartCommit.commitGuard.enabled`

**Type:** `boolean`
**Default:** `true`
**Scope:** Global
**Restart Required:** No

**Description:**
Enables the commit guard feature that warns when committing files from multiple change lists.

**When `true`:**
- Validates staged files before commit (via guarded commit command or keybinding)
- Shows warning dialog if files are from multiple lists
- Options: Unstage extra files, Commit anyway, or Cancel

**When `false`:**
- Commit guard is completely bypassed
- All commits proceed without validation
- No warnings about mixed change lists

**Example:**

```json
{
  "smartCommit.commitGuard.enabled": false
}
```

**When to Disable:**
- You intentionally commit mixed changes frequently
- You find the warnings disruptive
- You have other validation mechanisms

**Note:** Even when enabled, the guard only activates when using:
- `Smart Commit: Commit (with Guard)` command
- `Ctrl+Enter` / `Cmd+Enter` keybinding (if `interceptCommit` is enabled)

---

#### `smartCommit.commitGuard.interceptCommit`

**Type:** `boolean`
**Default:** `false`
**Scope:** Global
**Restart Required:** **Yes** (VS Code restart required)

**Description:**
Intercepts the native Git commit command (`Ctrl+Enter` / `Cmd+Enter`) to apply the commit guard.

**When `true`:**
- `Ctrl+Enter` / `Cmd+Enter` in the SCM input box triggers the guard
- Commit validation runs automatically before every keybinding commit
- Seamless integration with normal workflow

**When `false`:**
- `Ctrl+Enter` / `Cmd+Enter` uses native Git commit (no guard)
- Guard only applies when using `Smart Commit: Commit (with Guard)` command
- Must explicitly choose guarded commit

**Example:**

```json
{
  "smartCommit.commitGuard.interceptCommit": true
}
```

**Important Notes:**
- **Requires restart**: Changes take effect only after reloading VS Code
- **Keybinding only**: Does NOT intercept the commit button (checkmark icon)
- **Depends on `enabled`**: If `commitGuard.enabled` is `false`, interception is inactive

**When to Enable:**
- You always want commit validation
- You primarily use `Ctrl+Enter` to commit (not the button)
- You want guard protection by default

**When to Leave Disabled:**
- You want explicit control over when guard runs
- You frequently commit from command palette
- You prefer opt-in guard behavior

---

### Debug and Logging

#### `smartCommit.debug.enableLogging`

**Type:** `boolean`
**Default:** `true`
**Scope:** Global
**Restart Required:** No (takes effect immediately)

**Description:**
Enables verbose DEBUG-level logging to the "Smart Commit" output channel.

**When `true`:**
- Logs DEBUG, INFO, WARN, ERROR, and EVENT messages
- Detailed operation traces (Git operations, state changes, file assignments)
- Useful for troubleshooting and understanding behavior

**When `false`:**
- Logs only INFO, WARN, ERROR, and EVENT messages
- Less verbose output
- Reduces console noise

**Example:**

```json
{
  "smartCommit.debug.enableLogging": false
}
```

**Log Levels:**

| Level | Always Logged | With Debug Enabled |
|-------|---------------|-------------------|
| DEBUG | ❌ | ✓ |
| INFO | ✓ | ✓ |
| WARN | ✓ | ✓ |
| ERROR | ✓ | ✓ |
| EVENT | ✓ | ✓ |

**When to Enable:**
- Investigating unexpected behavior
- Reporting bugs (include logs in issue)
- Understanding how Smart Commit works
- Learning about internal operations

**When to Disable:**
- Stable usage with no issues
- Large repositories (reduces log volume)
- Performance-sensitive environments
- Minimal distraction preference

**Viewing Logs:**
1. Press `Ctrl+Shift+U` / `Cmd+Shift+U` (Output panel)
2. Select "Smart Commit" from dropdown
3. Filter by search if needed

See [DEBUGGING.md](DEBUGGING.md) for more details.

---

### JetBrains / PhpStorm Integration

#### `gitChangeLists.ideaSync.enabled`

**Type:** `boolean`
**Default:** `true`
**Scope:** Workspace
**Restart Required:** No

**Description:**
Enables bi-directional synchronization of change lists and file mappings with PhpStorm and other JetBrains IDEs via the `.idea/workspace.xml` file.

**When `true`:**
- Automatically imports change lists and file mappings from PhpStorm on startup and watches the file for changes
- Periodically checks for external updates using a polling fallback (every 2.5 seconds) to work reliably on WSL/UNC shares
- Exports local change list state back to `.idea/workspace.xml` when files are moved or lists are updated

**When `false`:**
- Disables all PhpStorm synchronization features

> [!NOTE]
> **JetBrains Sync Limitation**: Since JetBrains IDEs keep their change list state in memory and only flush to `.idea/workspace.xml` when the IDE loses focus, during an auto-save, or when explicitly saved, the synchronization from PhpStorm/IntelliJ to VS Code may not always feel real-time. Changes made in VS Code, however, are immediately exported back to PhpStorm.

---

#### `gitChangeLists.ideaSync.interval`

**Type:** `integer`
**Default:** `1000`
**Scope:** Global
**Restart Required:** No

**Description:**
Debounce interval (in milliseconds) used when exporting local change list changes back to the `.idea/workspace.xml` file. Prevents excessive disk writes during rapid operations.

---

## Configuration Examples

### Minimal Configuration (Defaults)

Use Smart Commit with all default settings:

```json
{}
```

All settings use their default values. This is the recommended starting point for new users.

---

### Power User Configuration

Optimized for experienced users who want maximum control:

```json
{
  "smartCommit.defaultViewMode": "tree",
  "smartCommit.showStatusBar": true,
  "smartCommit.confirmDeleteNonEmpty": false,
  "smartCommit.autoActivateNew": false,
  "smartCommit.commitGuard.enabled": true,
  "smartCommit.commitGuard.interceptCommit": true,
  "smartCommit.autoAssignStagedFiles": true,
  "smartCommit.debug.enableLogging": false
}
```

**Rationale:**
- `tree` mode for structured view of large projects
- Status bar enabled for quick reference
- No delete confirmations (fast workflow)
- Manual activation (explicit control)
- Commit guard enabled with interception (safety by default)
- Auto-assign staged files (consistency)
- Debug logging off (reduced noise)

---

### Minimal Distraction Configuration

For users who want minimal UI and manual control:

```json
{
  "smartCommit.defaultViewMode": "list",
  "smartCommit.showStatusBar": false,
  "smartCommit.confirmDeleteNonEmpty": true,
  "smartCommit.autoActivateNew": false,
  "smartCommit.commitGuard.enabled": false,
  "smartCommit.commitGuard.interceptCommit": false,
  "smartCommit.autoAssignStagedFiles": false,
  "smartCommit.debug.enableLogging": false
}
```

**Rationale:**
- Simple list view
- No status bar clutter
- Manual control over everything
- No automatic behaviors
- Minimal logging

---

### Safety-First Configuration

Maximizes confirmations and guards:

```json
{
  "smartCommit.defaultViewMode": "tree",
  "smartCommit.showStatusBar": true,
  "smartCommit.confirmDeleteNonEmpty": true,
  "smartCommit.autoActivateNew": true,
  "smartCommit.commitGuard.enabled": true,
  "smartCommit.commitGuard.interceptCommit": true,
  "smartCommit.autoAssignStagedFiles": true,
  "smartCommit.debug.enableLogging": true
}
```

**Rationale:**
- All safety features enabled
- Confirmations for destructive operations
- Commit guard always active
- Verbose logging for transparency
- Good for teams or critical projects

---

### Large Project Configuration

Optimized for repositories with 1000+ files:

```json
{
  "smartCommit.defaultViewMode": "list",
  "smartCommit.showStatusBar": true,
  "smartCommit.confirmDeleteNonEmpty": false,
  "smartCommit.autoActivateNew": true,
  "smartCommit.commitGuard.enabled": true,
  "smartCommit.commitGuard.interceptCommit": false,
  "smartCommit.autoAssignStagedFiles": true,
  "smartCommit.debug.enableLogging": false
}
```

**Rationale:**
- List mode for faster rendering (less tree construction overhead)
- Debug logging off to reduce log volume
- No delete confirmations (faster workflow)
- Commit guard available but opt-in (less interruption)

---

## Recommended Configurations

### By Workflow

#### Feature Development Workflow

Multiple features in parallel, clean commits:

```json
{
  "smartCommit.autoActivateNew": true,
  "smartCommit.commitGuard.enabled": true,
  "smartCommit.commitGuard.interceptCommit": true
}
```

#### Experimental/Spike Workflow

Trying different approaches, frequent reorganization:

```json
{
  "smartCommit.confirmDeleteNonEmpty": false,
  "smartCommit.autoActivateNew": false,
  "smartCommit.autoAssignStagedFiles": false
}
```

#### Code Review Preparation

Organizing commits for PRs:

```json
{
  "smartCommit.defaultViewMode": "tree",
  "smartCommit.commitGuard.enabled": true,
  "smartCommit.commitGuard.interceptCommit": true
}
```

---

### By Project Size

#### Small Project (<100 files)

```json
{
  "smartCommit.defaultViewMode": "list",
  "smartCommit.debug.enableLogging": true
}
```

#### Medium Project (100-500 files)

```json
{
  "smartCommit.defaultViewMode": "tree",
  "smartCommit.debug.enableLogging": true
}
```

#### Large Project (500+ files)

```json
{
  "smartCommit.defaultViewMode": "list",
  "smartCommit.debug.enableLogging": false
}
```

---

## Workspace vs Global Settings

Smart Commit settings can be configured at different scopes:

### Global Settings (User)

Apply to all workspaces:
- Located in User settings
- Path: `~/.config/Code/User/settings.json` (Linux/Mac) or `%APPDATA%\Code\User\settings.json` (Windows)

**Best for:**
- Personal preferences (status bar visibility, confirmations)
- Behavioral defaults (auto-activate, auto-assign)
- Debug settings

### Workspace Settings

Apply only to the current workspace:
- Located in workspace settings
- Path: `.vscode/settings.json` in project root

**Best for:**
- View mode preferences (list vs tree)
- Project-specific overrides

### Setting Scope Reference

| Setting | Recommended Scope | Can Override in Workspace? |
|---------|-------------------|---------------------------|
| `defaultViewMode` | Workspace | Yes (recommended) |
| `showStatusBar` | Global | Yes |
| `confirmDeleteNonEmpty` | Global | Yes |
| `autoActivateNew` | Global | Yes |
| `commitGuard.enabled` | Global | Yes |
| `commitGuard.interceptCommit` | Global | Yes |
| `autoAssignStagedFiles` | Global | Yes |
| `debug.enableLogging` | Global | Yes |

### Override Example

**User settings** (global):
```json
{
  "smartCommit.defaultViewMode": "list",
  "smartCommit.showStatusBar": true
}
```

**Workspace settings** (override for large project):
```json
{
  "smartCommit.defaultViewMode": "tree"
}
```

Result: This workspace uses tree mode, all others use list mode.

---

## Troubleshooting Configuration

### Settings Not Taking Effect

**Issue:** Changed a setting but behavior hasn't changed.

**Solutions:**
1. **Check scope**: Workspace settings override global settings
2. **Restart VS Code**: Some settings require restart (`interceptCommit`)
3. **Check spelling**: Setting names are case-sensitive
4. **Check syntax**: Invalid JSON causes settings to be ignored

### Keybinding Conflicts

**Issue:** `Ctrl+Enter` doesn't trigger commit guard.

**Solutions:**
1. **Enable interception**: Set `commitGuard.interceptCommit` to `true`
2. **Restart VS Code**: Keybinding changes require restart
3. **Check keybinding conflicts**: Another extension may override `Ctrl+Enter`
4. **Use Command Palette**: Run `Smart Commit: Commit (with Guard)` instead

### Commit Guard Not Warning

**Issue:** Committing mixed change lists without warning.

**Solutions:**
1. **Check `enabled`**: Ensure `commitGuard.enabled` is `true`
2. **Use keybinding**: Guard only works with `Ctrl+Enter` (if intercepted) or command palette
3. **Not button-triggered**: Native commit button bypasses guard (VS Code limitation)

### Debug Logs Not Appearing

**Issue:** Output channel is empty or missing DEBUG logs.

**Solutions:**
1. **Enable logging**: Set `debug.enableLogging` to `true`
2. **Open correct channel**: Select "Smart Commit" from Output panel dropdown
3. **Check log level**: INFO/WARN/ERROR always logged; DEBUG only when enabled

### View Mode Not Persisting

**Issue:** View mode resets on restart.

**Solutions:**
1. **Set default**: Configure `defaultViewMode` to your preference
2. **Check workspace override**: Workspace setting may override global
3. **Clear state**: Try deleting workspace state (rare corruption)

---

## Advanced Configuration

### Multi-Root Workspaces

Each root can have independent settings:

**Root 1** (`.vscode/settings.json`):
```json
{
  "smartCommit.defaultViewMode": "tree"
}
```

**Root 2** (`.vscode/settings.json`):
```json
{
  "smartCommit.defaultViewMode": "list"
}
```

Each workspace folder respects its own settings.

### Per-Language Defaults (Future)

Not currently supported, but planned:
- Different defaults for TypeScript vs Python projects
- Auto-detect based on `package.json` or `setup.py`

---

## Configuration Schema

Full JSON schema for autocomplete and validation:

Smart Commit's settings are defined in `package.json` under `contributes.configuration`. VS Code automatically provides:
- Autocomplete when editing `settings.json`
- Validation and error messages for invalid values
- IntelliSense documentation on hover

---

## See Also

- [FEATURES.md](FEATURES.md) - Feature details and behavior
- [USER_GUIDE.md](USER_GUIDE.md) - Usage workflows
- [DEBUGGING.md](DEBUGGING.md) - Debug logging guide
- [FAQ.md](FAQ.md) - Common questions

---

Have configuration questions? [Open an issue](https://github.com/maxinne-dev/vscode-smart-commit/issues) or check the [FAQ](FAQ.md)!

- [GitHub Repository](https://github.com/maxinne-dev/vscode-smart-commit)
