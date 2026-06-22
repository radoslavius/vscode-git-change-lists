import * as vscode from 'vscode';
import * as path from 'path';
import { ChangeListManager } from '../services/changeListManager';
import { GitService } from '../services/gitService';
import { ConfigService } from '../services/configService';
import { PatchService } from '../services/patchService';
import { ChangeListTreeDataProvider } from '../providers/treeDataProvider';
import { AnyTreeNode, ChangeListNode, FileNode } from '../types';
import { COMMANDS } from '../utils/constants';

/**
 * Register all extension commands
 */
export function registerCommands(
  changeListManager: ChangeListManager,
  gitService: GitService,
  configService: ConfigService,
  patchService: PatchService,
  treeDataProvider: ChangeListTreeDataProvider,
  treeView: vscode.TreeView<AnyTreeNode>
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Create Change List
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.CREATE_LIST, async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter a name for the new change list',
        placeHolder: 'Change list name',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Name cannot be empty';
          }
          const lists = changeListManager.getLists();
          if (lists.some((list) => list.name === value.trim())) {
            return 'A change list with this name already exists';
          }
          return null;
        },
      });

      if (name) {
        try {
          const setActive = configService.getAutoActivateNew();
          await changeListManager.create(name.trim(), undefined, undefined, setActive);
          vscode.window.showInformationMessage(`Change list "${name}" created`);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to create change list: ${error}`);
        }
      }
    })
  );

  // Delete Change List
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.DELETE_LIST, async (node?: ChangeListNode) => {
      if (!node || node.type !== 'changeList') {
        return;
      }

      const list = node.changeList;

      if (list.isDefault) {
        vscode.window.showWarningMessage('Cannot delete the default change list');
        return;
      }

      // Confirm deletion if non-empty and configured to do so
      if (node.fileCount > 0 && configService.getConfirmDeleteNonEmpty()) {
        const confirm = await vscode.window.showWarningMessage(
          `Delete change list "${list.name}"? It contains ${node.fileCount} file(s) that will be moved to the Default list.`,
          { modal: true },
          'Delete'
        );

        if (confirm !== 'Delete') {
          return;
        }
      }

      try {
        await changeListManager.delete(list.id);
        vscode.window.showInformationMessage(`Change list "${list.name}" deleted`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to delete change list: ${error}`);
      }
    })
  );

  // Rename Change List
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.RENAME_LIST, async (node?: ChangeListNode) => {
      if (!node || node.type !== 'changeList') {
        return;
      }

      const list = node.changeList;

      const newName = await vscode.window.showInputBox({
        prompt: 'Enter a new name for the change list',
        value: list.name,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Name cannot be empty';
          }
          const lists = changeListManager.getLists();
          if (lists.some((l) => l.id !== list.id && l.name === value.trim())) {
            return 'A change list with this name already exists';
          }
          return null;
        },
      });

      if (newName && newName.trim() !== list.name) {
        try {
          await changeListManager.rename(list.id, newName.trim());
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to rename change list: ${error}`);
        }
      }
    })
  );

  // Set Active Change List
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.SET_ACTIVE_LIST, async (node?: ChangeListNode) => {
      let listId: string | undefined;

      if (node && node.type === 'changeList') {
        listId = node.changeList.id;
      } else {
        // Show quick pick to select a list
        const lists = changeListManager.getLists();
        const items = lists
          .filter(list => !list.isReadOnly)
          .map((list) => ({
            label: list.name,
            description: list.isActive ? '(Active)' : list.isDefault ? '(Default)' : undefined,
            listId: list.id,
          }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a change list to set as active',
        });

        if (selected) {
          listId = selected.listId;
        }
      }

      if (listId) {
        try {
          await changeListManager.setActive(listId);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to set active change list: ${error}`);
        }
      }
    })
  );

  // Set Change List Color
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.SET_LIST_COLOR, async (node?: ChangeListNode) => {
      let listId: string | undefined;

      if (node && node.type === 'changeList') {
        listId = node.changeList.id;
      } else {
        // Show quick pick to select a list
        const lists = changeListManager.getLists();
        const items = lists.map((list) => ({
          label: list.name,
          description: list.isActive ? '(Active)' : list.isDefault ? '(Default)' : undefined,
          listId: list.id,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a change list to set color',
        });

        if (selected) {
          listId = selected.listId;
        }
      }

      if (!listId) {
        return;
      }

      // Predefined colors from VS Code theme colors
      const colors = [
        { label: 'Default (None)', value: undefined },
        { label: '$(circle-large-filled) Red', value: 'charts.red' },
        { label: '$(circle-large-filled) Blue', value: 'charts.blue' },
        { label: '$(circle-large-filled) Green', value: 'charts.green' },
        { label: '$(circle-large-filled) Yellow', value: 'charts.yellow' },
        { label: '$(circle-large-filled) Orange', value: 'charts.orange' },
        { label: '$(circle-large-filled) Purple', value: 'charts.purple' },
      ];

      const selectedColor = await vscode.window.showQuickPick(colors, {
        placeHolder: 'Select a color',
      });

      // We explicitly check if undefined was selected (to clear) or a value was selected
      // Note: selectedColor is undefined if user cancels, so we need to handle that distinction if possible
      // But here user picks 'Default' which has value undefined.
      // So if selectedColor is NOT undefined, we proceed.
      // Wait, if user cancels, selectedColor is undefined.
      // If user picks 'Default', selectedColor is the object { label: ..., value: undefined }

      if (selectedColor) {
        try {
          await changeListManager.setColor(listId, selectedColor.value);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to set color: ${error}`);
        }
      }
    })
  );


  // Move to Change List
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.MOVE_TO_LIST, async (node?: FileNode, nodes?: FileNode[]) => {
      // Get selected files
      let filesToMove: string[] = [];

      if (nodes && nodes.length > 0) {
        // Multi-selection
        filesToMove = nodes
          .map((n: any) => {
            if (n && n.type === 'file' && n.change && n.change.resourceUri) {
              return n.change.resourceUri.fsPath;
            }
            if (n && n.resourceUri) {
              return n.resourceUri.fsPath;
            }
            return '';
          })
          .filter(Boolean);
      } else if (node) {
        const anyNode = node as any;
        if (anyNode.type === 'file' && anyNode.change && anyNode.change.resourceUri) {
          filesToMove = [anyNode.change.resourceUri.fsPath];
        } else if (anyNode.resourceUri) {
          filesToMove = [anyNode.resourceUri.fsPath];
        }
      }

      if (filesToMove.length === 0) {
        return;
      }

      // Show quick pick to select target list
      const lists = changeListManager.getLists();
      const items = [
        {
          label: '$(add) Create New Change List...',
          listId: '__new__',
        },
        ...lists
          // .filter(list => !list.isReadOnly) // Allow moving to Unversioned Files (triggers unstage)
          .map((list) => ({
            label: list.name,
            description: list.isActive ? '(Active)' : list.isDefault ? '(Default)' : undefined,
            listId: list.id,
          })),
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Move ${filesToMove.length} file(s) to...`,
      });

      if (!selected) {
        return;
      }

      let targetListId: string;

      if (selected.listId === '__new__') {
        // Create new list
        const name = await vscode.window.showInputBox({
          prompt: 'Enter a name for the new change list',
          placeHolder: 'Change list name',
        });

        if (!name) {
          return;
        }

        try {
          const newList = await changeListManager.create(name.trim(), undefined, undefined, false);
          targetListId = newList.id;
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to create change list: ${error}`);
          return;
        }
      } else {
        targetListId = selected.listId;
      }

      try {
        await changeListManager.moveFiles(filesToMove, targetListId);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to move files: ${error}`);
      }
    })
  );

  // Commit Change List
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.COMMIT_LIST, async (node?: ChangeListNode) => {
      if (!node || node.type !== 'changeList') {
        return;
      }

      const list = node.changeList;
      const files = await changeListManager.getFilesForList(list.id);

      if (files.length === 0) {
        vscode.window.showInformationMessage(`Change list "${list.name}" is empty`);
        return;
      }

      // Get commit message
      const defaultMessage = gitService.getInputBoxValue();
      const message = await vscode.window.showInputBox({
        prompt: `Commit ${files.length} file(s) from "${list.name}"`,
        placeHolder: 'Commit message',
        value: defaultMessage,
      });

      if (!message) {
        return;
      }

      try {
        // Stage only the files in this list
        const uris = files.map((f) => f.resourceUri);
        await gitService.stageFiles(uris);

        // Commit
        await gitService.commit(message);

        // Clear the input box
        gitService.setInputBoxValue('');

        // Remove committed files from mappings
        await changeListManager.removeFileMappings(files.map((f) => f.resourceUri.fsPath));

        vscode.window.showInformationMessage(
          `Committed ${files.length} file(s) from "${list.name}"`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to commit: ${error}`);
      }
    })
  );

  // Stage Change List
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.STAGE_LIST, async (node?: ChangeListNode) => {
      if (!node || node.type !== 'changeList') {
        return;
      }

      const list = node.changeList;
      const files = await changeListManager.getFilesForList(list.id);

      if (files.length === 0) {
        vscode.window.showInformationMessage(`Change list "${list.name}" is empty`);
        return;
      }

      try {
        const uris = files.map((f) => f.resourceUri);
        await gitService.stageFiles(uris);
        vscode.window.showInformationMessage(
          `Staged ${files.length} file(s) from "${list.name}"`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to stage files: ${error}`);
      }
    })
  );

  // Toggle View Mode
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.TOGGLE_VIEW_MODE, () => {
      treeDataProvider.toggleViewMode();
      const mode = treeDataProvider.getViewMode();
      vscode.window.showInformationMessage(`Switched to ${mode} view`);
    })
  );

  // Apply Patch
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.APPLY_PATCH, async (node?: ChangeListNode) => {
      let targetListId: string | undefined;

      if (node && node.type === 'changeList') {
        targetListId = node.changeList.id;
      } else {
        // Allow applying patch without context (ask for list)
        const lists = changeListManager.getLists();
        const items = lists.map((list) => ({
          label: list.name,
          description: list.isActive ? '(Active)' : list.isDefault ? '(Default)' : undefined,
          listId: list.id,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select change list to apply patch to',
        });

        if (selected) {
          targetListId = selected.listId;
        }
      }

      if (!targetListId) {
        return;
      }

      const source = await vscode.window.showQuickPick(['From File', 'From Clipboard'], {
        placeHolder: 'Where is the patch coming from?',
      });

      if (!source) {
        return;
      }

      try {
        if (source === 'From Clipboard') {
          const clipboardContent = await vscode.env.clipboard.readText();
          if (!clipboardContent) {
            vscode.window.showWarningMessage('Clipboard is empty');
            return;
          }

          // Create a temp file for the patch since standard git apply expects a file usually,
          // or we pipe it. Our PatchService.applyPatchToList takes a file path.
          // Let's defer to PatchService to handle this? 
          // Actually, PatchService.applyPatchToList takes a path. 
          // So we should write to a temp file.

          const tempUri = vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', 'temp_patch.diff'));
          await vscode.workspace.fs.writeFile(tempUri, Buffer.from(clipboardContent, 'utf8'));

          await patchService.applyPatchToList(targetListId, tempUri.fsPath);

          // Cleanup temp file
          await vscode.workspace.fs.delete(tempUri);

        } else {
          const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
              'Patch Files': ['patch', 'diff'],
              'All Files': ['*'],
            },
          });

          if (uris && uris.length > 0) {
            await patchService.applyPatchToList(targetListId, uris[0].fsPath);
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to apply patch: ${error}`);
      }
    })
  );

  // Create Patch
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.CREATE_PATCH, async (node?: ChangeListNode) => {
      if (!node || node.type !== 'changeList') {
        return;
      }

      const list = node.changeList;

      try {
        const patchContent = await patchService.generatePatchForList(list.id);

        if (!patchContent) {
          vscode.window.showInformationMessage('Change list is empty or has no changes to patch.');
          return;
        }

        const action = await vscode.window.showQuickPick(['Save to File', 'Copy to Clipboard'], {
          placeHolder: 'What would you like to do with the patch?',
        });

        if (action === 'Copy to Clipboard') {
          await vscode.env.clipboard.writeText(patchContent);
          vscode.window.showInformationMessage(`Patch for "${list.name}" copied to clipboard`);
        } else if (action === 'Save to File') {
          await patchService.savePatchToFile(list, patchContent);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create patch: ${error}`);
      }
    })
  );

  // Refresh
  disposables.push(
    vscode.commands.registerCommand(COMMANDS.REFRESH, async () => {
      await changeListManager.refresh();
      treeDataProvider.refresh();
    })
  );

  return disposables;
}
