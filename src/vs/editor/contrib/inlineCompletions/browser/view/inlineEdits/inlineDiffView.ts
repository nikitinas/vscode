/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, autorunWithStore, derived, IObservable, observableFromEvent } from '../../../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../../browser/editorBrowser.js';
import { observableCodeEditor } from '../../../../../browser/observableCodeEditor.js';
import { rangeIsSingleLine } from '../../../../../browser/widget/diffEditor/components/diffEditorViewZones/diffEditorViewZones.js';
import { LineSource, renderLines, RenderOptions } from '../../../../../browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js';
import { diffAddDecoration } from '../../../../../browser/widget/diffEditor/registrations.contribution.js';
import { applyViewZones, IObservableViewZone } from '../../../../../browser/widget/diffEditor/utils.js';
import { EditorOption } from '../../../../../common/config/editorOptions.js';
import { Range } from '../../../../../common/core/range.js';
import { AbstractText } from '../../../../../common/core/textEdit.js';
import { DetailedLineRangeMapping } from '../../../../../common/diff/rangeMapping.js';
import { IModelDeltaDecoration, ITextModel } from '../../../../../common/model.js';
import { ModelDecorationOptions } from '../../../../../common/model/textModel.js';
import { InlineDecoration, InlineDecorationType } from '../../../../../common/viewModel.js';
import { classNames } from './utils.js';

export interface IOriginalEditorInlineDiffViewState {
	diff: DetailedLineRangeMapping[];
	modifiedText: AbstractText;
	mode: 'mixedLines' | 'interleavedLines' | 'sideBySide';

	modifiedCodeEditor: ICodeEditor;
}

export class OriginalEditorInlineDiffView extends Disposable {
	public static supportsInlineDiffRendering(mapping: DetailedLineRangeMapping): boolean {
		return allowsTrueInlineDiffRendering(mapping);
	}

	constructor(
		private readonly _originalEditor: ICodeEditor,
		private readonly _state: IObservable<IOriginalEditorInlineDiffViewState | undefined>,
		private readonly _modifiedTextModel: ITextModel,
	) {
		super();
		console.log('[OriginalEditorInlineDiffView] CONSTRUCTOR - START (diff view being created), _state observable:', _state ? 'exists' : 'undefined');

		// Ensure _decorations is observed so it recomputes when _state changes
		// This is critical: derived observables only recompute when read
		// IMPORTANT: Read _state directly since _decorations depends on it, and read _decorations to ensure it recomputes
		const decorationsObs = this._decorations.map(d => {
			console.log('[OriginalEditorInlineDiffView] MAP decorationsObs - d:', d ? `exists (original: ${d.originalDecorations?.length ?? 0}, modified: ${d.modifiedDecorations?.length ?? 0})` : 'undefined', 'caller:', new Error().stack?.split('\n')[2]?.trim());
			return d?.originalDecorations ?? [];
		});

		// Explicitly observe _state to ensure decorationsObs recomputes when _state changes
		// This autorun ensures that when _state changes, decorationsObs recomputes, which triggers setDecorations
		// We read _state first to establish the dependency, then read decorationsObs to ensure it recomputes
		this._register(autorun(reader => {
			console.log('[OriginalEditorInlineDiffView] AUTORUN _state observer - START (observing)');
			// Read _state directly to ensure we observe it - this is critical for the autorun to re-run
			const state = this._state.read(reader);
			console.log('[OriginalEditorInlineDiffView] AUTORUN _state observer - _state read:', state ? `exists (mode: ${state.mode})` : 'undefined');
			// Read _decorations to ensure it recomputes when _state changes
			const decorations = this._decorations.read(reader);
			console.log('[OriginalEditorInlineDiffView] AUTORUN _state observer - _decorations read:', decorations ? `exists (original: ${decorations.originalDecorations?.length ?? 0}, modified: ${decorations.modifiedDecorations?.length ?? 0})` : 'undefined');
			// Read decorationsObs to ensure it recomputes and triggers setDecorations autorun
			const decorationsArray = decorationsObs.read(reader);
			console.log('[OriginalEditorInlineDiffView] AUTORUN _state observer - decorationsObs read, count:', decorationsArray.length);
		}));

		console.log('[OriginalEditorInlineDiffView] CONSTRUCTOR - registering setDecorations with decorationsObs');
		const setDecorationsResult = observableCodeEditor(this._originalEditor).setDecorations(decorationsObs);
		console.log('[OriginalEditorInlineDiffView] CONSTRUCTOR - setDecorations returned:', setDecorationsResult ? 'disposable' : 'undefined');
		this._register(setDecorationsResult);

		const modifiedCodeEditor = this._state.map(s => s?.modifiedCodeEditor);
		this._register(autorunWithStore((reader, store) => {
			const e = modifiedCodeEditor.read(reader);
			if (e) {
				store.add(observableCodeEditor(e).setDecorations(this._decorations.map(d => d?.modifiedDecorations ?? [])));
			}
		}));

		const editor = observableCodeEditor(this._originalEditor);

		const tokenizationFinished = modelTokenizationFinished(_modifiedTextModel);

		const originalViewZones = derived(this, (reader) => {
			const originalModel = editor.model.read(reader);
			if (!originalModel) { return []; }

			const origViewZones: IObservableViewZone[] = [];
			const renderOptions = RenderOptions.fromEditor(this._originalEditor);
			const modLineHeight = editor.getOption(EditorOption.lineHeight).read(reader);

			const s = this._state.read(reader);
			if (!s) { return origViewZones; }

			for (const diff of s.diff) {
				if (s.mode !== 'interleavedLines') {
					continue;
				}

				tokenizationFinished.read(reader); // Update view-zones once tokenization completes

				const source = new LineSource(diff.modified.mapToLineArray(l => this._modifiedTextModel.tokenization.getLineTokens(l)));

				const decorations: InlineDecoration[] = [];
				for (const i of diff.innerChanges || []) {
					decorations.push(new InlineDecoration(
						i.modifiedRange.delta(-(diff.original.startLineNumber - 1)),
						diffAddDecoration.className!,
						InlineDecorationType.Regular,
					));
				}

				const deletedCodeDomNode = document.createElement('div');
				deletedCodeDomNode.classList.add('view-lines', 'line-insert', 'monaco-mouse-cursor-text');
				// .inline-deleted-margin-view-zone

				const result = renderLines(source, renderOptions, decorations, deletedCodeDomNode);

				origViewZones.push({
					afterLineNumber: diff.original.endLineNumberExclusive - 1,
					domNode: deletedCodeDomNode,
					heightInPx: result.heightInLines * modLineHeight,
					minWidthInPx: result.minWidthInPx,

					showInHiddenAreas: true,
					suppressMouseDown: true,
				});
			}

			return origViewZones;
		});

		this._register(applyViewZones(this._originalEditor, originalViewZones));
	}

	private readonly _decorations = derived(this, reader => {
		console.log('[OriginalEditorInlineDiffView] _decorations DERIVED - START, caller:', new Error().stack?.split('\n')[2]?.trim());
		const diff = this._state.read(reader);
		console.log('[OriginalEditorInlineDiffView] _decorations DERIVED - _state read:', diff ? `exists (mode: ${diff.mode})` : 'undefined');
		if (!diff) {
			console.log('[OriginalEditorInlineDiffView] _decorations DERIVED - returning undefined');
			return undefined;
		}

		const modified = diff.modifiedText;
		const showInline = diff.mode === 'mixedLines';

		const showEmptyDecorations = true;

		const originalDecorations: IModelDeltaDecoration[] = [];
		const modifiedDecorations: IModelDeltaDecoration[] = [];

		const diffLineAddDecorationBackground = ModelDecorationOptions.register({
			className: 'inlineCompletions-line-insert',
			description: 'line-insert',
			isWholeLine: true,
			marginClassName: 'gutter-insert',
		});

		const diffLineAddDecorationBackgroundInterleavedFirst = ModelDecorationOptions.register({
			className: 'inlineCompletions-line-insert inlineCompletions-line-insert-interleaved inlineCompletions-line-insert-interleaved-first',
			description: 'line-insert-interleaved-first',
			isWholeLine: true,
			marginClassName: 'gutter-insert',
		});

		const diffLineAddDecorationBackgroundInterleavedMiddle = ModelDecorationOptions.register({
			className: 'inlineCompletions-line-insert inlineCompletions-line-insert-interleaved inlineCompletions-line-insert-interleaved-middle',
			description: 'line-insert-interleaved-middle',
			isWholeLine: true,
			marginClassName: 'gutter-insert',
		});

		const diffLineAddDecorationBackgroundInterleavedLast = ModelDecorationOptions.register({
			className: 'inlineCompletions-line-insert inlineCompletions-line-insert-interleaved inlineCompletions-line-insert-interleaved-last',
			description: 'line-insert-interleaved-last',
			isWholeLine: true,
			marginClassName: 'gutter-insert',
		});

		const diffLineDeleteDecorationBackground = ModelDecorationOptions.register({
			className: 'inlineCompletions-line-delete',
			description: 'line-delete',
			isWholeLine: true,
			marginClassName: 'gutter-delete',
		});

		const diffLineDeleteDecorationBackgroundInterleavedFirst = ModelDecorationOptions.register({
			className: 'inlineCompletions-line-delete inlineCompletions-line-delete-interleaved inlineCompletions-line-delete-interleaved-first',
			description: 'line-delete-interleaved-first',
			isWholeLine: true,
			marginClassName: 'gutter-delete',
		});

		const diffLineDeleteDecorationBackgroundInterleavedMiddle = ModelDecorationOptions.register({
			className: 'inlineCompletions-line-delete inlineCompletions-line-delete-interleaved inlineCompletions-line-delete-interleaved-middle',
			description: 'line-delete-interleaved-middle',
			isWholeLine: true,
			marginClassName: 'gutter-delete',
		});

		const diffLineDeleteDecorationBackgroundInterleavedLast = ModelDecorationOptions.register({
			className: 'inlineCompletions-line-delete inlineCompletions-line-delete-interleaved inlineCompletions-line-delete-interleaved-last',
			description: 'line-delete-interleaved-last',
			isWholeLine: true,
			marginClassName: 'gutter-delete',
		});

		const diffWholeLineDeleteDecoration = ModelDecorationOptions.register({
			className: 'inlineCompletions-char-delete',
			description: 'char-delete',
			isWholeLine: false,
		});

		const diffWholeLineAddDecoration = ModelDecorationOptions.register({
			className: 'inlineCompletions-char-insert',
			description: 'char-insert',
			isWholeLine: true,
		});

		const diffAddDecoration = ModelDecorationOptions.register({
			className: 'inlineCompletions-char-insert',
			description: 'char-insert',
			shouldFillLineOnLineBreak: true,
		});

		const diffAddDecorationEmpty = ModelDecorationOptions.register({
			className: 'inlineCompletions-char-insert diff-range-empty',
			description: 'char-insert diff-range-empty',
		});

		for (const m of diff.diff) {
			const showFullLineDecorations = diff.mode !== 'sideBySide';
			if (showFullLineDecorations) {
				if (!m.original.isEmpty) {
					if (diff.mode === 'interleavedLines') {
						const originalRange = m.original.toInclusiveRange()!;
						const numLines = originalRange.endLineNumber - originalRange.startLineNumber + 1;
						if (numLines === 1) {
							originalDecorations.push({
								range: originalRange,
								options: diffLineDeleteDecorationBackgroundInterleavedFirst,
							});
						} else {
							originalDecorations.push({
								range: new Range(originalRange.startLineNumber, 1, originalRange.startLineNumber, Number.MAX_SAFE_INTEGER),
								options: diffLineDeleteDecorationBackgroundInterleavedFirst,
							});
							for (let lineNum = originalRange.startLineNumber + 1; lineNum < originalRange.endLineNumber; lineNum++) {
								originalDecorations.push({
									range: new Range(lineNum, 1, lineNum, Number.MAX_SAFE_INTEGER),
									options: diffLineDeleteDecorationBackgroundInterleavedMiddle,
								});
							}
							originalDecorations.push({
								range: new Range(originalRange.endLineNumber, 1, originalRange.endLineNumber, Number.MAX_SAFE_INTEGER),
								options: diffLineDeleteDecorationBackgroundInterleavedLast,
							});
						}
					} else {
						originalDecorations.push({
							range: m.original.toInclusiveRange()!,
							options: diffLineDeleteDecorationBackground,
						});
					}
				}
				if (!m.modified.isEmpty) {
					if (diff.mode === 'interleavedLines') {
						const modifiedRange = m.modified.toInclusiveRange()!;
						const numLines = modifiedRange.endLineNumber - modifiedRange.startLineNumber + 1;
						if (numLines === 1) {
							modifiedDecorations.push({
								range: modifiedRange,
								options: diffLineAddDecorationBackgroundInterleavedFirst,
							});
						} else {
							modifiedDecorations.push({
								range: new Range(modifiedRange.startLineNumber, 1, modifiedRange.startLineNumber, Number.MAX_SAFE_INTEGER),
								options: diffLineAddDecorationBackgroundInterleavedFirst,
							});
							for (let lineNum = modifiedRange.startLineNumber + 1; lineNum < modifiedRange.endLineNumber; lineNum++) {
								modifiedDecorations.push({
									range: new Range(lineNum, 1, lineNum, Number.MAX_SAFE_INTEGER),
									options: diffLineAddDecorationBackgroundInterleavedMiddle,
								});
							}
							modifiedDecorations.push({
								range: new Range(modifiedRange.endLineNumber, 1, modifiedRange.endLineNumber, Number.MAX_SAFE_INTEGER),
								options: diffLineAddDecorationBackgroundInterleavedLast,
							});
						}
					} else {
						modifiedDecorations.push({
							range: m.modified.toInclusiveRange()!,
							options: diffLineAddDecorationBackground,
						});
					}
				}
			}

			if (m.modified.isEmpty || m.original.isEmpty) {
				if (!m.original.isEmpty) {
					originalDecorations.push({ range: m.original.toInclusiveRange()!, options: diffWholeLineDeleteDecoration });
				}
				if (!m.modified.isEmpty) {
					modifiedDecorations.push({ range: m.modified.toInclusiveRange()!, options: diffWholeLineAddDecoration });
				}
			} else {
				const useInlineDiff = showInline && allowsTrueInlineDiffRendering(m);
				for (const i of m.innerChanges || []) {
					// Don't show empty markers outside the line range
					if (m.original.contains(i.originalRange.startLineNumber)) {
						originalDecorations.push({
							range: i.originalRange,
							options: {
								description: 'char-delete',
								shouldFillLineOnLineBreak: false,
								className: classNames(
									'inlineCompletions-char-delete',
									(i.originalRange.isEmpty() && showEmptyDecorations && !useInlineDiff) && 'diff-range-empty'
								),
								inlineClassName: useInlineDiff ? 'strike-through' : null,
								zIndex: 1
							}
						});
					}
					if (m.modified.contains(i.modifiedRange.startLineNumber)) {
						modifiedDecorations.push({
							range: i.modifiedRange,
							options: (i.modifiedRange.isEmpty() && showEmptyDecorations && !useInlineDiff)
								? diffAddDecorationEmpty
								: diffAddDecoration
						});
					}
					if (useInlineDiff) {
						const insertedText = modified.getValueOfRange(i.modifiedRange);
						originalDecorations.push({
							range: Range.fromPositions(i.originalRange.getEndPosition()),
							options: {
								description: 'inserted-text',
								before: {
									content: insertedText,
									inlineClassName: 'inlineCompletions-char-insert',
								},
								zIndex: 2,
								showIfCollapsed: true,
							}
						});
					}
				}
			}
		}

		return { originalDecorations, modifiedDecorations };
	});
}

function allowsTrueInlineDiffRendering(mapping: DetailedLineRangeMapping): boolean {
	if (!mapping.innerChanges) {
		return false;
	}
	return mapping.innerChanges.every(c =>
		(rangeIsSingleLine(c.modifiedRange) && rangeIsSingleLine(c.originalRange)));
}

let i = 0;
function modelTokenizationFinished(model: ITextModel): IObservable<number> {
	return observableFromEvent(model.onDidChangeTokens, () => i++);
}
