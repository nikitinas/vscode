/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../../base/common/event.js';
import { derived, IObservable } from '../../../../../../base/common/observable.js';
import { localize } from '../../../../../../nls.js';
import { ICodeEditor } from '../../../../../browser/editorBrowser.js';
import { observableCodeEditor } from '../../../../../browser/observableCodeEditor.js';
import { LineRange } from '../../../../../common/core/lineRange.js';
import { StringText, TextEdit } from '../../../../../common/core/textEdit.js';
import { Command, InlineCompletionDisplayLocation } from '../../../../../common/languages.js';
import { InlineCompletionsModel } from '../../model/inlineCompletionsModel.js';
import { InlineCompletionWithUpdatedRange } from '../../model/inlineCompletionsSource.js';
import { IInlineEditHost, IInlineEditModel, InlineEditTabAction } from './inlineEditsViewInterface.js';
import { InlineEditWithChanges } from './inlineEditWithChanges.js';

export class InlineEditModel implements IInlineEditModel {

	readonly action: Command | undefined;
	readonly displayName: string;
	readonly extensionCommands: Command[];
	readonly displayLocation: InlineCompletionDisplayLocation | undefined;
	readonly showCollapsed: IObservable<boolean>;

	constructor(
		private readonly _model: InlineCompletionsModel,
		readonly inlineEdit: InlineEditWithChanges,
		readonly tabAction: IObservable<InlineEditTabAction>,
	) {
		const completion = this.inlineEdit.inlineCompletion.inlineCompletion;
		this.action = completion.command;
		// In 1.96, provider doesn't have displayName, use groupId or default
		const provider = completion.source.provider;
		this.displayName = (provider as any).groupId ?? localize('inlineEdit', "Inline Edit");
		this.extensionCommands = completion.source.inlineCompletions.commands ?? [];

		// Adapt displayLocation from hint if available
		const hint = completion.sourceInlineCompletion.hint;
		this.displayLocation = hint ? {
			range: hint.range,
			label: hint.content
		} : undefined;

		this.showCollapsed = this._model.showCollapsed;
	}

	accept() {
		this._model.accept();
	}

	jump() {
		this._model.jump();
	}

	abort(reason: string) {
		console.error(reason); // TODO: add logs/telemetry
		this._model.stop();
	}

	handleInlineEditShown() {
		this._model.handleInlineSuggestionShown(this.inlineEdit.inlineCompletion);
	}
}

export class InlineEditHost implements IInlineEditHost {
	readonly onDidAccept: Event<void>;
	readonly inAcceptFlow: IObservable<boolean>;

	constructor(
		private readonly _model: InlineCompletionsModel,
	) {
		this.onDidAccept = this._model.onDidAccept;
		this.inAcceptFlow = this._model.inAcceptFlow;
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
				if (inlineCompletion.inlineCompletion.sourceInlineCompletion.showInlineEditMenu) {
					return InlineEditTabAction.Accept;
				}
			}
			return InlineEditTabAction.Inactive;
		});

		const edit = inlineCompletion.toSingleTextEdit(undefined);
		this.model = new InlineEditModel(
			model,
			new InlineEditWithChanges(
				new StringText(''),
				new TextEdit([edit]),
				model.primaryPosition.get(),
				inlineCompletion.inlineCompletion.source.inlineCompletions.commands ?? [],
				inlineCompletion
			),
			tabAction,
		);
	}
}

