/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { h, svgElem } from '../../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, autorunWithStore, derived, IObservable, observableFromEvent } from '../../../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../../browser/editorBrowser.js';
import { observableCodeEditor } from '../../../../../browser/observableCodeEditor.js';
import { rangeIsSingleLine } from '../../../../../browser/widget/diffEditor/components/diffEditorViewZones/diffEditorViewZones.js';
import { LineSource, renderLines, RenderOptions } from '../../../../../browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js';
import { diffAddDecoration } from '../../../../../browser/widget/diffEditor/registrations.contribution.js';
import { appendRemoveOnDispose, applyViewZones, IObservableViewZone } from '../../../../../browser/widget/diffEditor/utils.js';
import { EditorOption } from '../../../../../common/config/editorOptions.js';
import { Range } from '../../../../../common/core/range.js';
import { AbstractText } from '../../../../../common/core/textEdit.js';
import { DetailedLineRangeMapping } from '../../../../../common/diff/rangeMapping.js';
import { IModelDeltaDecoration, ITextModel } from '../../../../../common/model.js';
import { ModelDecorationOptions } from '../../../../../common/model/textModel.js';
import { InlineDecoration, InlineDecorationType } from '../../../../../common/viewModel.js';
import { classNames, PathBuilder, Point } from './utils.js';

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

	private readonly _svgOverlay = h('div.inline-diff-svg-overlay', {
		style: {
			position: 'absolute',
			overflow: 'visible',
			top: '0px',
			left: '0px',
			pointerEvents: 'none',
		},
	}, [
		svgElem('svg@svg', { transform: 'translate(-0.5 -0.5)', style: { overflow: 'visible', pointerEvents: 'none', position: 'absolute' }, }, []),
	]);

	constructor(
		private readonly _originalEditor: ICodeEditor,
		private readonly _state: IObservable<IOriginalEditorInlineDiffViewState | undefined>,
		private readonly _modifiedTextModel: ITextModel,
	) {
		super();

		this._register(appendRemoveOnDispose(this._originalEditor.getDomNode()!, this._svgOverlay.root));

		this._register(observableCodeEditor(this._originalEditor).createOverlayWidget({
			domNode: this._svgOverlay.root,
			position: derived(reader => null),
			allowEditorOverflow: false,
			minContentWidthInPx: derived(reader => 0),
		}));

		this._register(observableCodeEditor(this._originalEditor).setDecorations(this._decorations.map(d => d?.originalDecorations ?? [])));

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
				deletedCodeDomNode.classList.add('view-lines', 'monaco-mouse-cursor-text');

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

		// Render SVG paths for interleaved lines mode
		this._register(autorun(reader => {
			const state = this._state.read(reader);
			if (!state || state.mode !== 'interleavedLines') {
				this._svgOverlay.svg.replaceChildren();
				return;
			}

			// Read view zones to get their heights
			originalViewZones.read(reader);

			const editorLayout = editor.layoutInfo.read(reader);
			const scrollTop = editor.scrollTop.read(reader);
			const scrollLeft = editor.scrollLeft.read(reader);
			const lineHeight = editor.getOption(EditorOption.lineHeight).read(reader);
			const contentLeft = editorLayout.contentLeft;
			const contentWidth = editorLayout.width - editorLayout.contentLeft - editorLayout.minimap.minimapWidth - editorLayout.verticalScrollbarWidth;
			const originalModel = editor.model.read(reader);
			const modifiedModel = this._modifiedTextModel;

			const paths: SVGElement[] = [];

			// Helper function to find min/max non-space columns in a line range
			const findContentBounds = (model: ITextModel, lineRange: Range): { minColumn: number; maxColumn: number } => {
				let minColumn = Number.MAX_SAFE_INTEGER;
				let maxColumn = 1;

				for (let lineNum = lineRange.startLineNumber; lineNum <= lineRange.endLineNumber; lineNum++) {
					const lineContent = model.getLineContent(lineNum);

					// Find first non-space character
					for (let i = 0; i < lineContent.length; i++) {
						if (lineContent[i] !== ' ' && lineContent[i] !== '\t') {
							minColumn = Math.min(minColumn, i + 1);
							break;
						}
					}

					// Find last non-space character
					for (let i = lineContent.length - 1; i >= 0; i--) {
						if (lineContent[i] !== ' ' && lineContent[i] !== '\t') {
							maxColumn = Math.max(maxColumn, i + 1);
							break;
						}
					}
				}

				return { minColumn: minColumn === Number.MAX_SAFE_INTEGER ? 1 : minColumn, maxColumn };
			};

			for (const diff of state.diff) {

				const originalRange = diff.original.toInclusiveRange()!;
				const modifiedRange = diff.modified.toInclusiveRange()!;

				const radius = diff.modified.isEmpty || diff.original.isEmpty ? 0 : 4;

				const renderOptions = RenderOptions.fromEditor(this._originalEditor);
				const isMonospace = renderOptions.fontInfo.isMonospace;
				const spaceWidth = renderOptions.fontInfo.spaceWidth;

				const isModifiedEmpty = diff.modified.isEmpty || (diff.innerChanges && diff.innerChanges.length > 0 && diff.innerChanges.every(inner => inner.modifiedRange.isEmpty()));
				const isOriginalEmpty = diff.original.isEmpty || (diff.innerChanges && diff.innerChanges.length > 0 && diff.innerChanges.every(inner => inner.originalRange.isEmpty()));
				if (isOriginalEmpty || isModifiedEmpty) {
					continue;
				}
				// Calculate content bounds for original lines
				const originalBounds = !diff.original.isEmpty && originalModel
					? findContentBounds(originalModel, originalRange)
					: null;

				// Calculate content bounds for modified lines (only if not empty)
				const modifiedBounds = !isModifiedEmpty ? findContentBounds(modifiedModel, modifiedRange) : null;

				// Find the minimal bounding box across all lines (original + modified)
				// If one is empty, use only the non-empty bounds
				const minColumn = Math.min(
					originalBounds?.minColumn ?? Number.MAX_SAFE_INTEGER,
					modifiedBounds?.minColumn ?? Number.MAX_SAFE_INTEGER
				);
				const maxColumn = Math.max(
					originalBounds?.maxColumn ?? 0,
					modifiedBounds?.maxColumn ?? 0
				);

				// Convert column positions to pixel offsets using spaceWidth
				// For monospace fonts, column position * spaceWidth gives pixel offset
				// Account for horizontal scroll
				let leftEdge: number;
				let rightEdge: number;

				if (isMonospace && minColumn !== Number.MAX_SAFE_INTEGER && maxColumn > 0) {
					// Use spaceWidth for pixel calculation (column - 1 because columns are 1-indexed)
					const leftOffset = spaceWidth * (minColumn - 1);
					const rightOffset = spaceWidth * maxColumn;
					leftEdge = contentLeft + Math.max(leftOffset - scrollLeft, 0);
					rightEdge = contentLeft + rightOffset - scrollLeft;
				} else {
					// Fallback: use whole line width for non-monospace fonts or invalid bounds
					leftEdge = contentLeft - scrollLeft;
					rightEdge = contentLeft + contentWidth - scrollLeft;
				}
				if (!isOriginalEmpty) {
					// Calculate positions for all original lines (deleted) - single path around entire block
					const originalFirstLineTop = this._originalEditor.getTopForLineNumber(originalRange.startLineNumber) - scrollTop;
					const originalLastLineTop = this._originalEditor.getTopForLineNumber(originalRange.endLineNumber) - scrollTop;
					const originalBlockTop = originalFirstLineTop;
					const originalBlockBottom = originalLastLineTop + lineHeight + 1;

					const pathBuilderOriginal = new PathBuilder();
					pathBuilderOriginal.moveTo(new Point(leftEdge + radius, originalBlockTop));
					pathBuilderOriginal.lineTo(new Point(rightEdge - radius, originalBlockTop));
					pathBuilderOriginal.curveTo(new Point(rightEdge, originalBlockTop), new Point(rightEdge, originalBlockTop + radius));
					if (isModifiedEmpty) {
						pathBuilderOriginal.lineTo(new Point(rightEdge, originalBlockBottom - radius));
						pathBuilderOriginal.curveTo(new Point(rightEdge, originalBlockBottom), new Point(rightEdge - radius, originalBlockBottom));
						pathBuilderOriginal.lineTo(new Point(leftEdge + radius, originalBlockBottom));
						pathBuilderOriginal.curveTo(new Point(leftEdge, originalBlockBottom), new Point(leftEdge, originalBlockBottom - radius));
						pathBuilderOriginal.lineTo(new Point(leftEdge, originalBlockTop + radius));
						pathBuilderOriginal.curveTo(new Point(leftEdge, originalBlockTop), new Point(leftEdge + radius, originalBlockTop));
					} else {
						pathBuilderOriginal.lineTo(new Point(rightEdge, originalBlockBottom));
						pathBuilderOriginal.lineTo(new Point(leftEdge, originalBlockBottom));
						pathBuilderOriginal.lineTo(new Point(leftEdge, originalBlockTop + radius));
						pathBuilderOriginal.curveTo(new Point(leftEdge, originalBlockTop), new Point(leftEdge + radius, originalBlockTop));
					}

					const pathOriginal = document.createElementNS('http://www.w3.org/2000/svg', 'path');
					pathOriginal.setAttribute('d', pathBuilderOriginal.build());
					if (!isModifiedEmpty) {
						pathOriginal.style.fill = 'var(--vscode-inlineEdit-originalBackground, transparent)';
						pathOriginal.style.stroke = 'var(--vscode-inlineEdit-originalBorder)';
						pathOriginal.style.strokeWidth = '1px';
					} else {
						pathOriginal.style.fill = 'transparent';
					}
					paths.push(pathOriginal);
				}

				if (!isModifiedEmpty) {

					// Calculate positions for all modified lines (inserted) - single path around entire block
					// Modified lines appear in the view zone after the original lines
					// View zone is inserted after originalRange.endLineNumberExclusive - 1
					// When original is empty, use the insertion point (original.startLineNumber - 1)
					const insertionLineNumber = diff.original.isEmpty
						? diff.original.startLineNumber - 1
						: diff.original.endLineNumberExclusive - 1;

					// Top of inserted block = bottom of the line before view zone
					const lineBeforeViewZoneBottom = this._originalEditor.getTopForLineNumber(insertionLineNumber) - scrollTop + lineHeight;
					// Bottom of inserted block = top of the line after view zone
					const lineAfterViewZoneTop = this._originalEditor.getTopForLineNumber(insertionLineNumber + 1) - scrollTop;
					const modifiedBlockTop = lineBeforeViewZoneBottom;
					const modifiedBlockBottom = lineAfterViewZoneTop;

					const pathBuilderModified = new PathBuilder();
					pathBuilderModified.moveTo(new Point(leftEdge, modifiedBlockTop));
					pathBuilderModified.lineTo(new Point(rightEdge, modifiedBlockTop));
					pathBuilderModified.lineTo(new Point(rightEdge, modifiedBlockBottom - radius));
					pathBuilderModified.curveTo(new Point(rightEdge, modifiedBlockBottom), new Point(rightEdge - radius, modifiedBlockBottom));
					pathBuilderModified.lineTo(new Point(leftEdge + radius, modifiedBlockBottom));
					pathBuilderModified.curveTo(new Point(leftEdge, modifiedBlockBottom), new Point(leftEdge, modifiedBlockBottom - radius));
					pathBuilderModified.lineTo(new Point(leftEdge, modifiedBlockTop));

					const pathModified = document.createElementNS('http://www.w3.org/2000/svg', 'path');
					pathModified.setAttribute('d', pathBuilderModified.build());
					pathModified.style.fill = 'var(--vscode-inlineEdit-modifiedBackground, transparent)';
					pathModified.style.stroke = 'var(--vscode-inlineEdit-modifiedBorder)';
					pathModified.style.strokeWidth = '1px';
					paths.push(pathModified);
				}
			}

			this._svgOverlay.svg.replaceChildren(...paths);
		}));
	}

	private readonly _decorations = derived(this, reader => {
		const diff = this._state.read(reader);
		if (!diff) { return undefined; }

		const modified = diff.modifiedText;
		const showInline = diff.mode === 'mixedLines';

		const showEmptyDecorations = true;

		const originalDecorations: IModelDeltaDecoration[] = [];
		const modifiedDecorations: IModelDeltaDecoration[] = [];

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

