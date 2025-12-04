# VS Code Inline Completion Analysis: isInlineEdit, showRange, and displayLocation

## Executive Summary

After analyzing the VS Code codebase, I've discovered that **`showRange` is not currently implemented in the filtering logic**. The property is defined in the API and passed through the protocol, but it's never checked when determining whether to display inline edits.

## Key Findings

### 1. **showRange is NOT Implemented**

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:496-521`

The critical code that selects inline edits:

```typescript
private readonly _inlineCompletionItems = derivedOpts({ owner: this }, reader => {
    const c = this._source.inlineCompletions.read(reader);
    if (!c) { return undefined; }
    const cursorPosition = this.primaryPosition.read(reader);
    let inlineEdit: InlineEditItem | undefined = undefined;
    const visibleCompletions: InlineCompletionItem[] = [];
    for (const completion of c.inlineCompletions) {
        if (!completion.isInlineEdit) {
            if (completion.isVisible(this.textModel, cursorPosition)) {
                visibleCompletions.push(completion);
            }
        } else {
            inlineEdit = completion;  // ⚠️ NO showRange CHECK HERE!
        }
    }
    // ...
});
```

**Problem**: When `isInlineEdit: true`, the item is automatically assigned without checking if the cursor is within `showRange`.

### 2. **showRange Property Flow**

The property flows through the system but is never used:

1. **API Definition**: `src/vs/editor/common/languages.ts:836`

   ```typescript
   /** Only show the inline suggestion when the cursor is in the showRange. */
   readonly showRange?: IRange;
   ```

2. **Protocol Conversion**: `src/vs/workbench/api/common/extHostLanguageFeatures.ts:1431`

   ```typescript
   showRange: (this._isAdditionsProposedApiEnabled && item.showRange)
       ? typeConvert.Range.from(item.showRange)
       : undefined,
   ```

3. **Storage**: The `showRange` is stored in `sourceInlineCompletion` (via `InlineSuggestData`), accessible via:

   ```typescript
   completion.getSourceCompletion().showRange;
   ```

4. **Missing Check**: No code checks this property before displaying inline edits.

### 3. **isInlineEdit Processing**

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:617-636`

When an inline edit is selected, it's processed here:

```typescript
const inlineEditResult = item?.inlineEdit;
if (inlineEditResult) {
	if (this._hasVisiblePeekWidgets.read(reader)) {
		return undefined;
	}
	// ... processing continues without showRange check
}
```

### 4. **displayLocation (hint) Implementation**

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineSuggestionItem.ts:167-200`

The `displayLocation` property is properly implemented:

1. **Conversion**: `displayLocation` → `hint` (InlineSuggestHint)

   ```typescript
   const displayLocation = data.hint
   	? InlineSuggestHint.create(data.hint)
   	: undefined;
   ```

2. **Storage**: Stored in `InlineSuggestionItemBase.hint`

3. **Usage**: Used in rendering logic:

   - `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsCustomView.ts`
   - `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsView.ts`

4. **Target Range**: The `hint.range` is used as `targetRange` when `jumpToEdit` is false:
   ```typescript
   public get targetRange(): Range {
       return this.hint?.range && !this.hint.jumpToEdit
           ? this.hint?.range
           : this.editRange;
   }
   ```

### 5. **Filtering Logic for Regular Inline Completions**

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineSuggestionItem.ts:300-344`

Regular inline completions (not inline edits) use `isVisible()` which checks:

- Cursor must be on the same line as the edit range
- Text matching logic
- But **NOT** `showRange` (even though it exists in the interface)

## The Missing Implementation

To fix `showRange`, you would need to add a check in `inlineCompletionsModel.ts`:

```typescript
for (const completion of c.inlineCompletions) {
	if (!completion.isInlineEdit) {
		if (completion.isVisible(this.textModel, cursorPosition)) {
			visibleCompletions.push(completion);
		}
	} else {
		// ✅ ADD THIS CHECK:
		const showRange = completion.getSourceCompletion().showRange;
		if (!showRange || Range.lift(showRange).containsPosition(cursorPosition)) {
			inlineEdit = completion;
		}
	}
}
```

## Why Your Suggestions Aren't Appearing

Based on your scenario:

```typescript
const item = new InlineCompletionItem("// TODO", new Range(5, 0, 5, 0));
item.isInlineEdit = true;
item.showRange = new Range(1, 0, 9, Number.MAX_SAFE_INTEGER);
```

**Root Cause**: Even though `showRange` is set correctly, VS Code never checks it. The inline edit is selected regardless of cursor position (unless there's a visible regular completion, which takes precedence).

## Additional Constraints

### 1. **Context Filtering**

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsSource.ts:238-244`

```typescript
if (
	!context.includeInlineEdits &&
	(item.isInlineEdit || item.showInlineEditMenu)
) {
	item.setNotShownReason("notInlineEditRequested");
	continue;
}
if (
	!context.includeInlineCompletions &&
	!(item.isInlineEdit || item.showInlineEditMenu)
) {
	item.setNotShownReason("notInlineCompletionRequested");
	continue;
}
```

**Requirement**: The context must have `includeInlineEdits: true` for inline edits to be considered.

### 2. **Precedence Rules**

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:512-515`

```typescript
if (visibleCompletions.length !== 0) {
	// Don't show the inline edit if there is a visible completion
	inlineEdit = undefined;
}
```

**Rule**: If any regular inline completion is visible, inline edits are hidden.

### 3. **Peek Widget Check**

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:619-621`

```typescript
if (this._hasVisiblePeekWidgets.read(reader)) {
	return undefined;
}
```

**Rule**: Inline edits are hidden when peek widgets are visible.

## Code Locations Summary

### Processing Flow

1. **Provider → Protocol**: `src/vs/workbench/api/common/extHostLanguageFeatures.ts:1431`

   - Converts `showRange` from extension API to internal format

2. **Protocol → Data**: `src/vs/editor/contrib/inlineCompletions/browser/model/provideInlineCompletions.ts:238-252`

   - Creates `InlineSuggestData` (stores `sourceInlineCompletion` with `showRange`)

3. **Data → Item**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineSuggestionItem.ts:346-364`

   - Creates `InlineEditItem` (doesn't extract `showRange`)

4. **Item → Selection**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:496-521`

   - **MISSING**: Should check `showRange` here

5. **Selection → Display**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:617-636`
   - Renders the selected inline edit

### Rendering Flow

1. **displayLocation → hint**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineSuggestionItem.ts:362`
2. **hint → view**: `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsView.ts:259`
3. **view → UI**: `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsCustomView.ts`

## Recommendations

### For Extension Developers

1. **Workaround**: Since `showRange` isn't implemented, you could:

   - Filter items in your provider based on cursor position
   - Only return items when cursor is in the desired range
   - This requires re-requesting when cursor moves

2. **Check Context**: Ensure `context.includeInlineEdits` is true when requesting

3. **Verify API Enablement**: Ensure `inlineCompletionsAdditions` API is enabled:
   ```typescript
   const isEnabled = vscode.extensions
   	.getExtension("vscode")
   	?.packageJSON.contributes?.apis?.includes("inlineCompletionsAdditions");
   ```

### For VS Code Contributors

1. **Implement showRange Check**: Add the check in `inlineCompletionsModel.ts:507-509`

2. **Consider Edge Cases**:

   - What if `showRange` overlaps with `range`?
   - Should `showRange` work for regular completions too?
   - How to handle multi-line `showRange`?

3. **Performance**: Consider caching the `showRange` check result

## Testing Your Scenario

For your example:

```typescript
const item = new InlineCompletionItem("// TODO", new Range(5, 0, 5, 0));
item.isInlineEdit = true;
item.showRange = new Range(1, 0, 9, Number.MAX_SAFE_INTEGER);
item.displayLocation = {
	range: new Range(5, 0, 5, 0),
	label: "Next edit",
	kind: 0,
	jumpToEdit: true,
};
```

**Expected Behavior** (if `showRange` were implemented):

- Cursor on line 3: ✅ Should display (cursor in showRange)
- Cursor on line 10: ❌ Should not display (cursor outside showRange)

**Actual Behavior** (current):

- Cursor anywhere: ✅ Displays if no regular completion is visible
- `showRange` is ignored

## Conclusion

The `showRange` property is **not implemented** in VS Code's filtering logic. This is a missing feature that needs to be added to the codebase. The `displayLocation` (hint) feature works correctly, but `showRange` filtering does not.

To get your extension working, you'll need to either:

1. Wait for VS Code to implement `showRange` filtering
2. Implement cursor-based filtering in your provider
3. Contribute the implementation to VS Code




