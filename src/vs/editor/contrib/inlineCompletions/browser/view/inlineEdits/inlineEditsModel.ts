/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { derived, IObservable, observableValue } from '../../../../../../base/common/observable.js';
import { localize } from '../../../../../../nls.js';
import { ICodeEditor } from '../../../../../browser/editorBrowser.js';
import { observableCodeEditor } from '../../../../../browser/observableCodeEditor.js';
import { LineRange } from '../../../../../common/core/lineRange.js';
import { TextEdit } from '../../../../../common/core/textEdit.js';
import { TextModelText } from '../../../../../common/model/textModelText.js';
import { Command } from '../../../../../common/languages.js';
import { InlineCompletionsModel } from '../../model/inlineCompletionsModel.js';
import { InlineCompletionWithUpdatedRange } from '../../model/inlineCompletionsSource.js';
import { IInlineEditHost, IInlineEditModel, InlineEditTabAction } from './inlineEditsViewInterface.js';
import { InlineEdit } from '../../model/inlineEdit.js';
import { InlineEditWithChanges } from './inlineEditsViewAndDiffProducer.js';

export class InlineEditModel implements IInlineEditModel {

	readonly action: Command | undefined;
	readonly displayName: string;
	readonly extensionCommands: Command[];

	readonly showCollapsed: IObservable<boolean>;
	readonly inlineEdit: InlineEditWithChanges;

	constructor(
		private readonly _model: InlineCompletionsModel,
		private readonly _editor: ICodeEditor,
		inlineEdit: InlineEdit,
		readonly tabAction: IObservable<InlineEditTabAction>,
	) {
		this.action = undefined; // Not available in backport
		this.displayName = localize('inlineEdit', "Inline Edit");
		this.extensionCommands = [];

		// Convert InlineEdit to InlineEditWithChanges
		const originalText = new TextModelText(this._editor.getModel()!);
		const textEdit = new TextEdit([inlineEdit.edit]);
		this.inlineEdit = new InlineEditWithChanges(
			originalText,
			textEdit,
			inlineEdit.isCollapsed,
			false, // userJumpedToIt
			inlineEdit.commands,
			inlineEdit.inlineCompletion
		);

		// Create a simple showCollapsed observable - adapt based on your backport's structure
		this.showCollapsed = observableValue(this, false);
	}

	accept() {
		this._model.accept(this._editor);
	}

	jump() {
		this._model.jump();
	}

	abort(reason: string) {
		console.error(reason);
		this._model.stop();
	}

	handleInlineEditShown() {
		this._model.handleInlineCompletionShown(this.inlineEdit.inlineCompletion);
	}
}

export class InlineEditHost implements IInlineEditHost {
	readonly onDidAccept: Event<void>;
	readonly inAcceptFlow: IObservable<boolean>;
	readonly inPartialAcceptFlow: IObservable<boolean>;

	private readonly _onDidAcceptEmitter = new Emitter<void>();

	constructor(
		private readonly _model: InlineCompletionsModel,
	) {
		this.onDidAccept = this._onDidAcceptEmitter.event;

		// Create observables - adapt based on your backport's structure
		// Access private _inAcceptFlow from model
		this.inAcceptFlow = (this._model as any)._inAcceptFlow ?? observableValue(this, false);
		this.inPartialAcceptFlow = observableValue(this, false);
	}
}

export class GhostTextIndicator {

	readonly model: InlineEditModel;

	constructor(
		editor: ICodeEditor,
		model: InlineCompletionsModel,
		readonly lineRange: LineRange,
		inlineCompletion: InlineCompletionWithUpdatedRange,
	) {
		const editorObs = observableCodeEditor(editor);
		const tabAction = derived<InlineEditTabAction>(this, reader => {
			if (editorObs.isFocused.read(reader)) {
				// Check if tab should accept - simplified for backport
				return InlineEditTabAction.Jump;
			}
			return InlineEditTabAction.Inactive;
		});

		// Create a simple InlineEdit for the model
		const edit = inlineCompletion.inlineCompletion.toSingleTextEdit();
		this.model = new InlineEditModel(
			model,
			editor,
			new InlineEdit(
				edit,
				false,
				false,
				[],
				inlineCompletion.inlineCompletion
			),
			tabAction,
		);
	}
}

