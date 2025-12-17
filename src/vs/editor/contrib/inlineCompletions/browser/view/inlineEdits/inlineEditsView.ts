/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { h, svgElem } from '../../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, constObservable, derived, derivedOpts, derivedWithStore, IObservable, observableFromEvent, observableValue, mapObservableArrayCached } from '../../../../../../base/common/observable.js';
import { MenuId, MenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor } from '../../../../../browser/editorBrowser.js';
import { observableCodeEditor } from '../../../../../browser/observableCodeEditor.js';
import { EmbeddedCodeEditorWidget } from '../../../../../browser/widget/codeEditor/embeddedCodeEditorWidget.js';
import { appendRemoveOnDispose } from '../../../../../browser/widget/diffEditor/utils.js';
import { EditorOption } from '../../../../../common/config/editorOptions.js';
import { LineRange } from '../../../../../common/core/lineRange.js';
import { Range } from '../../../../../common/core/range.js';
import { SingleTextEdit, StringText } from '../../../../../common/core/textEdit.js';
import { lineRangeMappingFromRangeMappings, RangeMapping } from '../../../../../common/diff/rangeMapping.js';
import { TextModel } from '../../../../../common/model/textModel.js';
import './inlineEditsView.css';
import { IOriginalEditorInlineDiffViewState, OriginalEditorInlineDiffView } from './inlineDiffView.js';
import { applyEditToModifiedRangeMappings, createReindentEdit, getOffsetForPos, maxContentWidthInRange, PathBuilder, Point, StatusBarViewItem } from './utils.js';
import { InlineEditsGutterIndicator } from './components/gutterIndicatorView.js';
import { InlineEditHost, InlineEditModel } from './inlineEditsModel.js';
import { InlineEditTabAction } from './inlineEditsViewInterface.js';
import { InlineEditsWordReplacementView } from './inlineEditsViews/inlineEditsWordReplacementView.js';
import { TextLength } from '../../../../../common/core/textLength.js';
import { InlineEdit } from '../../model/inlineEdit.js';
import { darken, lighten, registerColor, transparent } from '../../../../../../platform/theme/common/colorUtils.js';
import { diffInserted, diffRemoved } from '../../../../../../platform/theme/common/colorRegistry.js';
import { CustomizedMenuWorkbenchToolBar } from '../../hintsWidget/inlineCompletionsHintsWidget.js';
import { Command } from '../../../../../common/languages.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { structuralEquals } from '../../../../../../base/common/equals.js';
import { IAction } from '../../../../../../base/common/actions.js';
import { editorLineHighlightBorder } from '../../../../../common/core/editorColorRegistry.js';
import { ActionViewItem } from '../../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { InlineCompletionsModel } from '../../model/inlineCompletionsModel.js';
import { InlineEditWithChanges } from './inlineEditsViewAndDiffProducer.js';
import { OffsetRange } from '../../../../../common/core/offsetRange.js';
import { Color } from '../../../../../../base/common/color.js';

export const originalBackgroundColor = registerColor(
	'inlineEdit.originalBackground',
	transparent(diffRemoved, 0.4),
	'',
	true
);
export const modifiedBackgroundColor = registerColor(
	'inlineEdit.modifiedBackground',
	transparent(diffInserted, 0.4),
	'',
	true
);

export const originalChangedLineBackgroundColor = registerColor(
	'inlineEdit.originalChangedLineBackground',
	Color.transparent,
	'',
	true
);

export const originalChangedTextOverlayColor = registerColor(
	'inlineEdit.originalChangedTextBackground',
	diffRemoved,
	'',
	true
);

export const modifiedChangedLineBackgroundColor = registerColor(
	'inlineEdit.modifiedChangedLineBackground',
	Color.transparent,
	'',
	true
);

export const modifiedChangedTextOverlayColor = registerColor(
	'inlineEdit.modifiedChangedTextBackground',
	diffInserted,
	'',
	true
);

export const border = registerColor(
	'inlineEdit.border',
	{
		light: darken(editorLineHighlightBorder, 0.15),
		dark: lighten(editorLineHighlightBorder, 0.50),
		hcDark: editorLineHighlightBorder,
		hcLight: editorLineHighlightBorder
	},
	''
);

export class InlineEditsView extends Disposable {
	private readonly _editorObs = observableCodeEditor(this._editor);

	private readonly _elements = h('div.inline-edits-view', {
		style: {
			position: 'absolute',
			overflow: 'visible',
			top: '0px',
			left: '0px',
		},
	}, [
		svgElem('svg@svg', { transform: 'translate(-0.5 -0.5)', style: { overflow: 'visible', pointerEvents: 'none', position: 'absolute' }, }, []),
		h('div.editorContainer@editorContainer', { style: { position: 'absolute' } }, [
			h('div.preview@editor', { style: {} }),
			h('div.toolbar@toolbar', { style: {} }),
		]),
		svgElem('svg@svg2', { transform: 'translate(-0.5 -0.5)', style: { overflow: 'visible', pointerEvents: 'none', position: 'absolute' }, }, []),
	]);

	private readonly _allowHorizontalCodeShifting = observableCodeEditor(this._editor).getOption(EditorOption.inlineSuggest).map(s => s.edits.allowHorizontalCodeShifting);
	private readonly _allowVerticalCodeShifting = observableCodeEditor(this._editor).getOption(EditorOption.inlineSuggest).map(s => s.edits.allowVerticalCodeShifting);

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _edit: IObservable<InlineEditWithChanges | undefined>,
		private readonly _model: IObservable<InlineCompletionsModel | undefined>,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();

		this._register(appendRemoveOnDispose(this._editor.getDomNode()!, this._elements.root));

		this._register(this._editorObs.createOverlayWidget({
			domNode: this._elements.root,
			position: constObservable(null),
			allowEditorOverflow: false,
			minContentWidthInPx: derived(reader => {
				const x = this._previewEditorLayoutInfo.read(reader)?.maxContentWidth;
				if (x === undefined) { return 0; }
				return x;
			}),
		}));

		this._previewEditor.setModel(this._previewTextModel);


		this._register(autorun(reader => {
			const layoutInfo = this._previewEditorLayoutInfo.read(reader);
			if (!layoutInfo) {
				this._elements.svg.replaceChildren();
				return;
			}

			const topEdit = layoutInfo.edit1;
			const editHeight = layoutInfo.editHeight;

			const width = this._previewEditorWidth.read(reader);

			const pathBuilder1 = new PathBuilder();
			pathBuilder1.moveTo(layoutInfo.code2);
			pathBuilder1.lineTo(layoutInfo.codeStart2);
			pathBuilder1.lineTo(layoutInfo.codeStart1);
			pathBuilder1.lineTo(layoutInfo.code1);


			const pathBuilder2 = new PathBuilder();
			pathBuilder2.moveTo(layoutInfo.code1);
			pathBuilder2.lineTo(layoutInfo.edit1);
			pathBuilder2.lineTo(layoutInfo.edit1.deltaX(width));
			pathBuilder2.lineTo(layoutInfo.edit2.deltaX(width));
			pathBuilder2.lineTo(layoutInfo.edit2);
			if (layoutInfo.edit2.y !== layoutInfo.code2.y) {
				pathBuilder2.curveTo2(layoutInfo.edit2.deltaX(-20), layoutInfo.code2.deltaX(20), layoutInfo.code2.deltaX(0));
			}
			pathBuilder2.lineTo(layoutInfo.code2);

			const pathBuilder4 = new PathBuilder();
			pathBuilder4.moveTo(layoutInfo.code1);
			pathBuilder4.lineTo(layoutInfo.code1.deltaX(1000));
			pathBuilder4.lineTo(layoutInfo.code2.deltaX(1000));
			pathBuilder4.lineTo(layoutInfo.code2);

			const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path1.setAttribute('d', pathBuilder1.build());
			path1.style.fill = 'var(--vscode-inlineEdit-originalBackground, transparent)';
			path1.style.stroke = 'var(--vscode-inlineEdit-border)';
			path1.style.strokeWidth = '1px';


			const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path2.setAttribute('d', pathBuilder2.build());
			path2.style.fill = 'var(--vscode-inlineEdit-modifiedBackground, transparent)';
			path2.style.stroke = 'var(--vscode-inlineEdit-border)';
			path2.style.strokeWidth = '1px';

			const pathModifiedBackground = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			pathModifiedBackground.setAttribute('d', pathBuilder2.build());
			pathModifiedBackground.style.fill = 'var(--vscode-editor-background, transparent)';
			pathModifiedBackground.style.strokeWidth = '1px';



			const elements: SVGElement[] = [];
			if (layoutInfo.shouldShowShadow) {
				const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
				const linearGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
				linearGradient.setAttribute('id', 'gradient');
				linearGradient.setAttribute('x1', '0%');
				linearGradient.setAttribute('x2', '100%');

				const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
				stop1.setAttribute('offset', '0%');
				stop1.setAttribute('style', 'stop-color:var(--vscode-inlineEdit-border);stop-opacity:0');

				const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
				stop2.setAttribute('offset', '100%');
				stop2.setAttribute('style', 'stop-color:var(--vscode-inlineEdit-border);stop-opacity:1');

				linearGradient.appendChild(stop1);
				linearGradient.appendChild(stop2);
				defs.appendChild(linearGradient);

				const width = 6;
				const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				rect.setAttribute('x', `${layoutInfo.code1.x - width}`);
				rect.setAttribute('y', `${layoutInfo.code1.y}`);
				rect.setAttribute('width', `${width}`);
				rect.setAttribute('height', `${layoutInfo.code2.y - layoutInfo.code1.y}`);
				rect.setAttribute('fill', 'url(#gradient)');
				rect.style.strokeWidth = '0';
				rect.style.stroke = 'transparent';

				elements.push(defs);
				elements.push(rect);
			} else {
				const pathBuilder3 = new PathBuilder();
				pathBuilder3.moveTo(layoutInfo.code1);
				pathBuilder3.lineTo(layoutInfo.code2);

				const path3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
				path3.setAttribute('d', pathBuilder3.build());
				path3.style.stroke = 'var(--vscode-inlineEdit-border)';
				path3.style.strokeWidth = '1px';
				elements.push(path3);
			}

			const path4 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path4.setAttribute('d', pathBuilder4.build());
			path4.style.fill = 'var(--vscode-editor-background, transparent)';

			this._elements.svg.replaceChildren(path4, pathModifiedBackground);
			this._elements.svg2.replaceChildren(path1, path2, ...elements);

			this._elements.editorContainer.style.top = `${topEdit.y}px`;
			this._elements.editorContainer.style.left = `${topEdit.x}px`;

			this._previewEditor.layout({ height: editHeight, width });
		}));

		const toolbarDropdownVisible = observableFromEvent(this, this._toolbar.onDidChangeDropdownVisibility, (e) => e ?? false);

		this._register(autorun(reader => {
			this._elements.root.classList.toggle('toolbarDropdownVisible', toolbarDropdownVisible.read(reader));
		}));

		// Initialize word replacement views
		this._wordReplacementViews.recomputeInitiallyAndOnChange(this._store);

		// Keep indicator observed
		this._indicator.recomputeInitiallyAndOnChange(this._store);
	}

	private readonly _uiState = derived(this, reader => {
		const edit = this._edit.read(reader);
		if (!edit) { return undefined; }

		this._model.get()?.handleInlineCompletionShown(edit.inlineCompletion);

		let mappings = RangeMapping.fromEdit(edit.edit);
		let newText = edit.edit.apply(edit.originalText);
		let diff = lineRangeMappingFromRangeMappings(mappings, edit.originalText, new StringText(newText));

		// Check if this is a single word replacement
		const inner = diff.flatMap(d => d.innerChanges ?? []);

		const isWordReplacement = inner.length === 1
			&& edit.originalLineRange.length === 1 && edit.modifiedLineRange.length === 1
			&& !inner[0].modifiedRange.isEmpty() && !inner[0].originalRange.isEmpty()
			&& TextLength.ofRange(inner[0].originalRange).columnCount < InlineEditsWordReplacementView.MAX_LENGTH
			&& TextLength.ofRange(inner[0].modifiedRange).columnCount < InlineEditsWordReplacementView.MAX_LENGTH;

		let state: 'collapsed' | 'mixedLines' | 'interleavedLines' | 'sideBySide' | 'wordReplacements';
		if (edit.isCollapsed) {
			state = 'collapsed';
		} else if (isWordReplacement) {
			state = 'wordReplacements';
		} else {
			// Use allowHorizontalCodeShifting and allowVerticalCodeShifting settings to determine the diff presentation mode
			const allowHorizontal = this._allowHorizontalCodeShifting.read(reader);
			const allowVertical = this._allowVerticalCodeShifting.read(reader);

			// Check if all diffs support inline rendering (mixedLines mode)
			const supportsMixedLines = diff.every(m => OriginalEditorInlineDiffView.supportsInlineDiffRendering(m));

			// Check if all modified ranges are empty (only deletions, no insertions)
			const allModifiedEmpty = diff.every(m => m.modified.isEmpty);

			if (!allowHorizontal && !allowVertical) {
				// When both code shifting options are disabled, use interleavedLines if only deletions,
				// otherwise use side-by-side
				state = allModifiedEmpty ? 'interleavedLines' : 'sideBySide';
			} else if (allowHorizontal && supportsMixedLines) {
				// When horizontal code shifting is enabled and diff supports it, use mixedLines
				state = 'mixedLines';
			} else if (allowVertical) {
				// When vertical code shifting is enabled, use interleavedLines
				state = 'interleavedLines';
			} else {
				// Fallback: horizontal is enabled but diff doesn't support mixedLines, or only horizontal is enabled
				// Use interleavedLines if only deletions, otherwise side-by-side
				state = allModifiedEmpty ? 'interleavedLines' : 'sideBySide';
			}
		}

		if (state === 'sideBySide') {
			const indentationAdjustmentEdit = createReindentEdit(newText, edit.modifiedLineRange);
			newText = indentationAdjustmentEdit.applyToString(newText);

			mappings = applyEditToModifiedRangeMappings(mappings, indentationAdjustmentEdit);
			diff = lineRangeMappingFromRangeMappings(mappings, edit.originalText, new StringText(newText));
		}

		const originalDisplayRange = edit.originalText.lineRange.intersect(
			edit.originalLineRange.join(
				LineRange.ofLength(edit.originalLineRange.startLineNumber, edit.lineEdit.newLines.length)
			)
		)!;

		const replacements = state === 'wordReplacements'
			? inner.map(m => {
				const newTextObj = new StringText(newText);
				return new SingleTextEdit(m.originalRange, newTextObj.getValueOfRange(m.modifiedRange));
			})
			: undefined;

		return {
			state,
			diff,
			edit,
			newText,
			newTextLineCount: edit.modifiedLineRange.length,
			originalDisplayRange: originalDisplayRange,
			replacements,
		};
	});

	protected readonly _toolbar = this._register(this._instantiationService.createInstance(CustomizedMenuWorkbenchToolBar, this._elements.toolbar, MenuId.InlineEditsActions, {
		menuOptions: { renderShortTitle: true },
		toolbarOptions: {
			primaryGroup: g => g.startsWith('primary'),
		},
		actionViewItemProvider: (action, options) => {
			if (action instanceof MenuItemAction) {
				return this._instantiationService.createInstance(StatusBarViewItem, action, undefined);
			}
			if (action.class === undefined) {
				return this._instantiationService.createInstance(ActionViewItem, {}, action, { icon: false });
			}
			return undefined;
		},
		telemetrySource: 'inlineEditsToolbar'
	}));

	private readonly _extraCommands = derivedOpts<readonly Command[]>({ owner: this, equalsFn: structuralEquals }, reader => {
		return this._uiState.read(reader)?.edit.commands ?? [];
	});

	protected readonly _updateToolbarAutorun = this._register(autorun(reader => {
		/** @description extra commands */
		const extraCommands = this._extraCommands.read(reader);
		const primaryExtraActions: IAction[] = [];
		const secondaryExtraActions: IAction[] = [];
		for (const c of extraCommands) {
			const action: IAction = {
				class: undefined,
				id: c.id,
				enabled: true,
				tooltip: c.tooltip || '',
				label: c.title,
				run: (event) => {
					return this._commandService.executeCommand(c.id, ...(c.arguments ?? []));
				},
			};
			// TODO this is a hack just to make the feedback action more visible.
			if (c.title.toLowerCase().indexOf('feedback') !== -1) {
				primaryExtraActions.push(action);
			} else {
				secondaryExtraActions.push(action);
			}
		}

		this._toolbar.setAdditionalPrimaryActions(primaryExtraActions);
		this._toolbar.setAdditionalSecondaryActions(secondaryExtraActions);
	}));

	// #region preview editor

	private readonly _previewTextModel = this._register(this._instantiationService.createInstance(
		TextModel,
		'',
		this._editor.getModel()!.getLanguageId(),
		{ ...TextModel.DEFAULT_CREATION_OPTIONS, bracketPairColorizationOptions: { enabled: true, independentColorPoolPerBracketType: false } },
		null
	));

	private readonly _previewEditor = this._register(this._instantiationService.createInstance(
		EmbeddedCodeEditorWidget,
		this._elements.editor,
		{
			glyphMargin: false,
			lineNumbers: 'off',
			minimap: { enabled: false },
			guides: {
				indentation: false,
				bracketPairs: false,
				bracketPairsHorizontal: false,
				highlightActiveIndentation: false,
			},
			folding: false,
			selectOnLineNumbers: false,
			selectionHighlight: false,
			columnSelection: false,
			overviewRulerBorder: false,
			overviewRulerLanes: 0,
			lineDecorationsWidth: 0,
			lineNumbersMinChars: 0,
			bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: false },
			scrollBeyondLastLine: false,
			scrollbar: {
				vertical: 'hidden',
				horizontal: 'hidden',
				handleMouseWheel: false,
			},
			readOnly: true,
			wordWrap: 'off',
		},
		{ contributions: [], },
		this._editor
	));

	private readonly _previewEditorObs = observableCodeEditor(this._previewEditor);

	private readonly _previewEditorRootVisibility = derived(this, reader => this._uiState.read(reader)?.state === 'sideBySide' ? 'block' : 'none');
	private readonly _updatePreviewEditorRootVisibility = derived(reader => {
		this._elements.root.style.display = this._previewEditorRootVisibility.read(reader);
	});

	private readonly _updatePreviewEditor = derived(reader => {
		this._updatePreviewEditorRootVisibility.read(reader);

		const uiState = this._uiState.read(reader);
		if (!uiState) { return; }


		this._previewTextModel.setLanguage(this._editor.getModel()!.getLanguageId());
		this._previewTextModel.setValue(uiState.newText);
		const range = uiState.edit.originalLineRange;

		const hiddenAreas: Range[] = [];
		if (range.startLineNumber > 1) {
			hiddenAreas.push(new Range(1, 1, range.startLineNumber - 1, 1));
		}
		if (range.startLineNumber + uiState.newTextLineCount < this._previewTextModel.getLineCount() + 1) {
			hiddenAreas.push(new Range(range.startLineNumber + uiState.newTextLineCount, 1, this._previewTextModel.getLineCount() + 1, 1));
		}

		this._previewEditor.setHiddenAreas(hiddenAreas, undefined, true);

	}).recomputeInitiallyAndOnChange(this._store);

	private readonly _previewEditorWidth = derived(this, reader => {
		const edit = this._edit.read(reader);
		if (!edit) { return 0; }
		this._updatePreviewEditor.read(reader);

		return maxContentWidthInRange(this._previewEditorObs, edit.modifiedLineRange, reader) + 10;
	});

	private readonly _cursorPosIfTouchesEdit = derived(this, reader => {
		const cursorPos = this._editorObs.cursorPosition.read(reader);
		const edit = this._edit.read(reader);
		if (!edit || !cursorPos) { return undefined; }
		return edit.modifiedLineRange.contains(cursorPos.lineNumber) ? cursorPos : undefined;
	});

	/**
	 * ![test](./layout.dio.svg)
	*/
	private readonly _previewEditorLayoutInfo = derived(this, (reader) => {
		const inlineEdit = this._edit.read(reader);
		if (!inlineEdit) {
			return null;
		}
		const state = this._uiState.read(reader);
		if (!state) {
			return null;
		}

		const range = inlineEdit.originalLineRange;

		const horizontalScrollOffset = this._editorObs.scrollLeft.read(reader);

		const editorContentMaxWidthInRange = maxContentWidthInRange(this._editorObs, state.originalDisplayRange, reader);
		const editorLayout = this._editorObs.layoutInfo.read(reader);
		const previewWidth = this._previewEditorWidth.read(reader);
		const editorContentAreaWidth = editorLayout.width - editorLayout.contentLeft - editorLayout.minimap.minimapWidth - editorLayout.verticalScrollbarWidth;

		const cursorPos = this._cursorPosIfTouchesEdit.read(reader);

		const maxPreviewEditorLeft = Math.max(
			editorContentAreaWidth * 0.65 + horizontalScrollOffset - 10,
			editorContentAreaWidth - previewWidth - 70 + horizontalScrollOffset - 10,
			cursorPos ? getOffsetForPos(this._editorObs, cursorPos, reader) + 50 : 0,
		);
		const previewEditorLeftInTextArea = Math.min(editorContentMaxWidthInRange + 20, maxPreviewEditorLeft);

		const previewEditorLeft = editorLayout.contentLeft + previewEditorLeftInTextArea;
		const maxContentWidth = editorContentMaxWidthInRange + 20 + previewWidth + 70;

		const dist = maxPreviewEditorLeft - previewEditorLeftInTextArea;

		const left = Math.max(editorLayout.contentLeft, previewEditorLeft - horizontalScrollOffset);

		const selectionTop = this._editor.getTopForLineNumber(range.startLineNumber) - this._editorObs.scrollTop.read(reader);
		const selectionBottom = this._editor.getTopForLineNumber(range.endLineNumberExclusive) - this._editorObs.scrollTop.read(reader);

		const codeLeft = editorLayout.contentLeft;

		const code1 = new Point(left, selectionTop);
		const codeStart1 = new Point(codeLeft, selectionTop);
		const code2 = new Point(left, selectionBottom);
		const codeStart2 = new Point(codeLeft, selectionBottom);
		const codeHeight = selectionBottom - selectionTop;

		const codeEditDistRange =
			inlineEdit.modifiedLineRange.length === inlineEdit.originalLineRange.length
				? new OffsetRange(4, 61)
				: new OffsetRange(60, 61);

		const clipped = dist === 0;

		const codeEditDist = codeEditDistRange.clip(dist);
		const editHeight = this._editor.getOption(EditorOption.lineHeight) * inlineEdit.modifiedLineRange.length;

		const edit1 = new Point(left + codeEditDist, selectionTop);
		const edit2 = new Point(left + codeEditDist, selectionTop + editHeight);

		return {
			code1,
			codeStart1,
			code2,
			codeStart2,
			codeHeight,

			edit1,
			edit2,
			editHeight,
			previewEditorLeft,
			maxContentWidth,
			shouldShowShadow: clipped,
		};
	});

	// #endregion

	private readonly _inlineDiffViewState = derived<IOriginalEditorInlineDiffViewState | undefined>(this, reader => {
		const e = this._uiState.read(reader);
		if (!e) { return undefined; }
		if (e.state === 'wordReplacements') { return undefined; } // Don't use inline diff view for word replacements

		return {
			modifiedText: new StringText(e.newText),
			diff: e.diff,
			mode: e.state === 'collapsed' ? 'sideBySide' : e.state,
			modifiedCodeEditor: this._previewEditor,
		};
	});
	protected readonly _inlineDiffView = this._register(new OriginalEditorInlineDiffView(this._editor, this._inlineDiffViewState, this._previewTextModel));

	private readonly _tabAction = derived(this, reader => {
		if (!this._editorObs.isFocused.read(reader)) {
			return InlineEditTabAction.Inactive;
		}

		const model = this._model.read(reader);
		if (!model) {
			return InlineEditTabAction.Inactive;
		}

		const inlineEditState = model.inlineEditState.read(reader);
		if (!inlineEditState) {
			return InlineEditTabAction.Inactive;
		}

		// For indicator display, check cursorAtInlineEdit directly
		// This ensures the indicator updates even when _tabShouldIndent is true (empty lines)
		// Also check if tab should accept (which includes the jumpedTo check)
		if (model.tabShouldAcceptInlineEdit.read(reader)) {
			return InlineEditTabAction.Accept;
		}

		// If cursor is at inline edit but tabShouldAcceptInlineEdit is false (due to indent),
		// still show Accept state for the indicator
		if (inlineEditState.cursorAtInlineEdit) {
			return InlineEditTabAction.Accept;
		}

		// Cursor is not at inline edit, so tab should jump
		return InlineEditTabAction.Jump;
	});

	protected readonly _wordReplacementViews = mapObservableArrayCached(this, this._uiState.map(s => s?.state === 'wordReplacements' && s.replacements ? s.replacements : []), (edit, store) => {
		const view = store.add(this._instantiationService.createInstance(InlineEditsWordReplacementView, this._editorObs, edit, this._tabAction));
		store.add(view.onDidClick(() => {
			const model = this._model.get();
			if (model) {
				model.accept(this._editor);
			}
		}));
		return view;
	});

	private readonly _inlineEditModel = derived(this, reader => {
		const model = this._model.read(reader);
		if (!model) { return undefined; }
		const edit = this._edit.read(reader);
		if (!edit) { return undefined; }

		// Convert InlineEditWithChanges to InlineEdit for the model
		// edit.edit is a TextEdit, we need to get a SingleTextEdit from it
		const singleEdit = edit.edit.toSingle(edit.originalText);
		const inlineEdit = new InlineEdit(
			singleEdit,
			edit.isCollapsed,
			edit.userJumpedToIt,
			edit.commands,
			edit.inlineCompletion
		);
		return new InlineEditModel(model, this._editor, inlineEdit, this._tabAction);
	});

	private readonly _inlineEditHost = derived(this, reader => {
		const model = this._model.read(reader);
		if (!model) { return undefined; }
		return new InlineEditHost(model);
	});

	private readonly _isHoveringOverInlineEdit = derived(this, reader => {
		// Check if hovering over word replacement views
		return this._wordReplacementViews.read(reader).some(v => v.isHovered.read(reader));
	});

	private readonly _focusIsInMenu = observableValue(this, false);

	protected readonly _indicator = derivedWithStore(this, (reader, store) => {
		const model = this._inlineEditModel.read(reader);
		const host = this._inlineEditHost.read(reader);
		const edit = this._edit.read(reader);
		if (!model || !host || !edit) { return undefined; }

		const originalRange = derived(this, reader => {
			const e = this._edit.read(reader);
			if (!e) { return undefined; }
			// When only insertions occur (original is empty), use the line before the view zone
			// In 1.99, originalLines uses s.lineNumber which may be adjusted to lineNumber - 1 in some cases
			// The view zone is inserted after startLineNumber - 1, so we use that line for the range
			if (e.originalLineRange.length === 0 && e.modifiedLineRange.length > 0) {
				// Use startLineNumber - 1 (the line before the view zone) - matches 1.99's adjusted s.lineNumber
				return LineRange.ofLength(e.originalLineRange.startLineNumber - 1, 1);
			}
			return e.originalLineRange;
		});

		// Calculate vertical offset for insertions (similar to startLineOffset in 1.99)
		// In 1.99, startLineOffset = topOffset from trimVertically, which accounts for leading newlines
		// For our backport, we position at the first inserted line in the view zone
		// Only apply verticalOffset in interleavedLines mode - in sideBySide mode, no offset is needed
		const verticalOffset = derived(this, reader => {
			const e = this._edit.read(reader);
			if (!e) { return 0; }

			if (e.originalLineRange.length === 0 && e.modifiedLineRange.length > 0) {
				// The view zone is inserted after startLineNumber - 1
				// We're using startLineNumber - 1 for the range, so targetRect spans that line
				// targetRect.top = getTopForLineNumber(startLineNumber - 1) - scrollTop
				// targetRect.bottom = getBottomForLineNumber(startLineNumber - 1) - scrollTop
				// The first inserted line is at targetRect.bottom (where view zone starts)
				// pillRect.top starts at targetRect.top, so we need verticalOffset = lineHeight to position at targetRect.bottom
				return this._editorObs.getOption(EditorOption.lineHeight).read(reader);
			}
			return 0;
		});

		return store.add(this._instantiationService.createInstance(
			InlineEditsGutterIndicator,
			this._editorObs,
			originalRange,
			verticalOffset,
			constObservable(host),
			constObservable(model),
			this._isHoveringOverInlineEdit,
			this._focusIsInMenu,
		));
	});
}
