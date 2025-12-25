/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LRUCachedFunction } from '../../../../../../base/common/cache.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { equalsIfDefined, itemEquals } from '../../../../../../base/common/equals.js';
import { createHotClass } from '../../../../../../base/common/hotReloadHelpers.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { derivedDisposable, ObservablePromise, derived, IObservable, derivedOpts } from '../../../../../../base/common/observable.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor } from '../../../../../browser/editorBrowser.js';
import { IDiffProviderFactoryService } from '../../../../../browser/widget/diffEditor/diffProviderFactoryService.js';
import { SingleLineEdit } from '../../../../../common/core/lineEdit.js';
import { Position } from '../../../../../common/core/position.js';
import { Range } from '../../../../../common/core/range.js';
import { SingleTextEdit, TextEdit, AbstractText } from '../../../../../common/core/textEdit.js';
import { TextLength } from '../../../../../common/core/textLength.js';
import { Command } from '../../../../../common/languages.js';
import { TextModelText } from '../../../../../common/model/textModelText.js';
import { IModelService } from '../../../../../common/services/model.js';
import { ITextModel } from '../../../../../common/model.js';
import { RangeMapping } from '../../../../../common/diff/rangeMapping.js';
import { InlineCompletionsModel } from '../../model/inlineCompletionsModel.js';
import { InlineEdit } from '../../model/inlineEdit.js';
import { InlineCompletionItem } from '../../model/provideInlineCompletions.js';
import { InlineEditsView } from './inlineEditsView.js';
import { UniqueUriGenerator } from './utils.js';
import { CharCode } from '../../../../../../base/common/charCode.js';

/**
 * Checks if a character code represents a word character (alphanumeric)
 */
function isWordChar(charCode: number): boolean {
	return (charCode >= CharCode.a && charCode <= CharCode.z)
		|| (charCode >= CharCode.A && charCode <= CharCode.Z)
		|| (charCode >= CharCode.Digit0 && charCode <= CharCode.Digit9);
}

/**
 * Finds the word containing the given position in the text.
 * Returns the start and end offsets (0-based) of the word, or undefined if not in a word.
 */
function findWordContaining(text: string, position: number): { start: number; end: number } | undefined {
	if (position < 0 || position >= text.length) {
		return undefined;
	}

	if (!isWordChar(text.charCodeAt(position))) {
		return undefined;
	}

	// Find start
	let start = position;
	while (start > 0 && isWordChar(text.charCodeAt(start - 1))) {
		start--;
	}

	// Find end
	let end = position;
	while (end < text.length && isWordChar(text.charCodeAt(end))) {
		end++;
	}

	return { start, end };
}

/**
 * Merges inner changes that together form word replacements by extending boundaries to word boundaries.
 * For example, if "text" is replaced with "text1", the diff might show an insertion at the end.
 * This function extends it to include the full word: "text" -> "text1"
 */
function mergeWordReplacements(
	innerChanges: RangeMapping[],
	originalModel: ITextModel,
	modifiedModel: ITextModel
): RangeMapping[] {
	if (innerChanges.length === 0) {
		return innerChanges;
	}

	// Step 1: Check if all changes are in the same line
	const firstLine = innerChanges[0].originalRange.startLineNumber;
	const firstModifiedLine = innerChanges[0].modifiedRange.startLineNumber;
	if (firstLine !== firstModifiedLine) {
		// Original and modified text are on different lines, don't merge
		return innerChanges;
	}

	if (!innerChanges.every(c =>
		c.originalRange.startLineNumber === firstLine
		&& c.originalRange.endLineNumber === firstLine
		&& c.modifiedRange.startLineNumber === firstLine
		&& c.modifiedRange.endLineNumber === firstLine
	)) {
		// Original text spans multiple lines or changes are on different lines, don't merge
		return innerChanges;
	}

	const originalLineContent = originalModel.getLineContent(firstLine);

	// Step 2: For each inner change, extend its boundaries in original text to word boundaries
	const extendedChanges: Array<{ originalWordStart: number; originalWordEnd: number; change: RangeMapping }> = [];

	for (const change of innerChanges) {
		// Find the word boundaries for this change in the original text
		let wordStart: number | undefined;
		let wordEnd: number | undefined;

		if (!change.originalRange.isEmpty()) {
			// Change has content - find word containing the start and end
			const startOffset = change.originalRange.startColumn - 1;
			const endOffset = change.originalRange.endColumn - 1;

			if (startOffset >= 0 && endOffset <= originalLineContent.length) {
				const startWord = findWordContaining(originalLineContent, startOffset);
				const endWord = endOffset > 0 ? findWordContaining(originalLineContent, endOffset - 1) : startWord;

				if (startWord && endWord) {
					wordStart = startWord.start;
					wordEnd = endWord.end;
				}
			}
		} else {
			// Empty original range (insertion) - find word at insertion point
			const insertOffset = change.originalRange.startColumn - 1;
			if (insertOffset > 0 && insertOffset <= originalLineContent.length) {
				const charBefore = originalLineContent.charCodeAt(insertOffset - 1);
				if (isWordChar(charBefore)) {
					// Insertion is after a word character - find the word containing it
					const word = findWordContaining(originalLineContent, insertOffset - 1);
					if (word) {
						// Extend to include the full word (works for both middle and end insertions)
						wordStart = word.start;
						wordEnd = word.end;
					}
				} else if (insertOffset < originalLineContent.length) {
					// Check if insertion is before a word character (insertion in the middle)
					const charAfter = originalLineContent.charCodeAt(insertOffset);
					if (isWordChar(charAfter)) {
						const word = findWordContaining(originalLineContent, insertOffset);
						if (word) {
							wordStart = word.start;
							wordEnd = word.end;
						}
					}
				}
			}
		}

		if (wordStart !== undefined && wordEnd !== undefined) {
			extendedChanges.push({ originalWordStart: wordStart, originalWordEnd: wordEnd, change });
		} else {
			// Can't extend this change to word boundaries, abort
			return innerChanges;
		}
	}

	// Step 3: Check if all extended changes produce the same word boundaries
	if (extendedChanges.length === 0) {
		return innerChanges;
	}

	const firstWordStart = extendedChanges[0].originalWordStart;
	const firstWordEnd = extendedChanges[0].originalWordEnd;

	if (!extendedChanges.every(ec => ec.originalWordStart === firstWordStart && ec.originalWordEnd === firstWordEnd)) {
		// Not all changes extend to the same word boundaries
		return innerChanges;
	}

	// Step 4: All changes extend to the same word - merge them into a single word replacement
	// For the modified text, we need to properly map the original word boundaries to modified text
	const firstChange = extendedChanges[0].change;
	const modifiedLineContent = modifiedModel.getLineContent(firstChange.modifiedRange.startLineNumber);

	// Calculate the modified text range by tracking cumulative offset changes
	// Start with the original word boundaries
	let modifiedStart = firstWordStart;
	let modifiedEnd = firstWordEnd;

	// Apply each change to calculate the net effect on positions
	// Sort changes by original position to apply them in order
	const sortedChanges = [...extendedChanges].sort((a, b) =>
		a.change.originalRange.startColumn - b.change.originalRange.startColumn
	);

	let cumulativeOffset = 0;
	for (const { change } of sortedChanges) {
		const originalStart = change.originalRange.startColumn - 1;
		const originalEnd = change.originalRange.endColumn - 1;
		const modifiedStart = change.modifiedRange.startColumn - 1;
		const modifiedEnd = change.modifiedRange.endColumn - 1;

		const originalLength = originalEnd - originalStart;
		const modifiedLength = modifiedEnd - modifiedStart;
		const deltaLength = modifiedLength - originalLength;

		// Accumulate the offset for positions after this change
		cumulativeOffset += deltaLength;
	}

	// Apply the cumulative offset to the word end
	modifiedStart = firstWordStart;
	modifiedEnd = firstWordEnd + cumulativeOffset;

	// Ensure we don't go beyond the line bounds
	modifiedStart = Math.max(0, modifiedStart);
	modifiedEnd = Math.min(modifiedEnd, modifiedLineContent.length);

	// Extract the actual text to validate this is a real replacement
	const originalWordText = originalLineContent.substring(firstWordStart, firstWordEnd);
	const modifiedText = modifiedLineContent.substring(modifiedStart, modifiedEnd);

	// Don't merge if:
	// 1. The texts are identical (no actual change)
	// 2. Either text is empty (deletion or pure insertion, not replacement)
	if (originalWordText === modifiedText || originalWordText.length === 0 || modifiedText.length === 0) {
		return innerChanges;
	}

	return [new RangeMapping(
		new Range(
			firstLine,
			firstWordStart + 1,
			firstLine,
			firstWordEnd + 1
		),
		new Range(
			firstChange.modifiedRange.startLineNumber,
			modifiedStart + 1,
			firstChange.modifiedRange.startLineNumber,
			modifiedEnd + 1
		)
	)];
}

export class InlineEditsViewAndDiffProducer extends Disposable {
	public static readonly hot = createHotClass(InlineEditsViewAndDiffProducer);

	private readonly _modelUriGenerator = new UniqueUriGenerator('inline-edits');

	private readonly _originalModel = derivedDisposable(() => this._modelService.createModel(
		'', null, this._modelUriGenerator.getUniqueUri())).keepObserved(this._store);
	private readonly _modifiedModel = derivedDisposable(() => this._modelService.createModel(
		'', null, this._modelUriGenerator.getUniqueUri())).keepObserved(this._store);

	private readonly _differ = new LRUCachedFunction({ getCacheKey: JSON.stringify }, (arg: { original: string; modified: string }) => {
		this._originalModel.get().setValue(arg.original);
		this._modifiedModel.get().setValue(arg.modified);

		const diffAlgo = this._diffProviderFactoryService.createDiffProvider({ diffAlgorithm: 'advanced' });

		return ObservablePromise.fromFn(async () => {
			const result = await diffAlgo.computeDiff(this._originalModel.get(), this._modifiedModel.get(), {
				computeMoves: false,
				ignoreTrimWhitespace: false,
				maxComputationTimeMs: 1000,
			}, CancellationToken.None);
			return result;
		});
	});

	private readonly _inlineEditPromise = derived<IObservable<InlineEditWithChanges | undefined> | undefined>(this, (reader) => {
		const inlineEdit = this._edit.read(reader);
		if (!inlineEdit) { return undefined; }

		//if (inlineEdit.text.trim() === '') { return undefined; }
		const text = new TextModelText(this._editor.getModel()!);
		const edit = inlineEdit.edit.extendToFullLine(text);

		const diffResult = this._differ.get({ original: this._editor.getModel()!.getValueInRange(edit.range), modified: edit.text });

		return diffResult.promiseResult.map(p => {
			if (!p || !p.data) {
				return undefined;
			}
			const result = p.data;

			const rangeStartPos = edit.range.getStartPosition();
			let innerChanges = result.changes.flatMap(c => c.innerChanges!);

			// Merge word replacements to improve detection of single word replacement cases
			innerChanges = mergeWordReplacements(innerChanges, this._originalModel.get()!, this._modifiedModel.get()!);

			function addRangeToPos(pos: Position, range: Range): Range {
				const start = TextLength.fromPosition(range.getStartPosition());
				return TextLength.ofRange(range).createRange(start.addToPosition(pos));
			}

			const edits = innerChanges.map(c => new SingleTextEdit(
				addRangeToPos(rangeStartPos, c.originalRange),
				this._modifiedModel.get()!.getValueInRange(c.modifiedRange)
			));
			const diffEdits = new TextEdit(edits);

			return new InlineEditWithChanges(text, diffEdits, inlineEdit.isCollapsed, inlineEdit.renderExplicitly, inlineEdit.commands, inlineEdit.inlineCompletion); //inlineEdit.showInlineIfPossible);
		});
	});

	private readonly _inlineEdit = derivedOpts({ owner: this, equalsFn: equalsIfDefined(itemEquals()) }, reader => this._inlineEditPromise.read(reader)?.read(reader));

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _edit: IObservable<InlineEdit | undefined>,
		private readonly _model: IObservable<InlineCompletionsModel | undefined>,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IDiffProviderFactoryService private readonly _diffProviderFactoryService: IDiffProviderFactoryService,
		@IModelService private readonly _modelService: IModelService
	) {
		super();

		this._register(this._instantiationService.createInstance(InlineEditsView, this._editor, this._inlineEdit, this._model));
	}
}

export class InlineEditWithChanges {
	public readonly lineEdit = SingleLineEdit.fromSingleTextEdit(this.edit.toSingle(this.originalText), this.originalText);

	public readonly originalLineRange = this.lineEdit.lineRange;
	public readonly modifiedLineRange = this.lineEdit.toLineEdit().getNewLineRanges()[0];

	constructor(
		public readonly originalText: AbstractText,
		public readonly edit: TextEdit,
		public readonly isCollapsed: boolean,
		public readonly userJumpedToIt: boolean,
		public readonly commands: readonly Command[],
		public readonly inlineCompletion: InlineCompletionItem,
	) {
	}

	equals(other: InlineEditWithChanges) {
		return this.originalText.getValue() === other.originalText.getValue() &&
			this.edit.equals(other.edit) &&
			this.isCollapsed === other.isCollapsed &&
			this.userJumpedToIt === other.userJumpedToIt &&
			this.commands === other.commands &&
			this.inlineCompletion === other.inlineCompletion;
	}
}
