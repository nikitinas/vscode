# Answers to Your Questions About VS Code Inline Completions

## 1. How does VS Code process and filter InlineCompletionItem with isInlineEdit?

### Where is isInlineEdit checked?

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:496-521`

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
            inlineEdit = completion;  // ⚠️ Automatically selected, no filtering
        }
    }
    // ...
});
```

### Additional validation/filtering steps:

1. **Context filtering** (`src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsSource.ts:238-244`):

   - Must have `context.includeInlineEdits: true`
   - Otherwise, item is skipped with reason `'notInlineEditRequested'`

2. **Precedence rule** (`inlineCompletionsModel.ts:512-515`):

   - If any regular inline completion is visible, inline edits are hidden

3. **Peek widget check** (`inlineCompletionsModel.ts:619-621`):
   - Hidden when peek widgets are visible

### Conditions for display:

- ✅ `isInlineEdit: true`
- ✅ `context.includeInlineEdits: true`
- ✅ No visible regular inline completions
- ✅ No visible peek widgets
- ❌ **showRange is NOT checked** (this is the bug)

---

## 2. showRange Implementation

### How VS Code uses showRange:

**Answer**: **It doesn't!** The property is defined and passed through the protocol, but **never checked** in the filtering logic.

### What "cursor within showRange" should mean:

Based on the interface comment (`src/vs/editor/common/languages.ts:835`):

> "Only show the inline suggestion when the cursor is in the showRange."

It should mean: `Range.lift(showRange).containsPosition(cursorPosition)`

### Edge cases/limitations:

Since it's not implemented, there are no edge cases to document. However, if it were implemented, consider:

- Multi-line `showRange` behavior
- Empty `showRange` (should it mean "never show"?)
- `showRange` overlapping with `range`

### Does VS Code validate showRange overlaps with cursor?

**No.** The check doesn't exist.

---

## 3. displayLocation Rendering

### How VS Code renders displayLocation:

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsCustomView.ts`

1. **Conversion**: `displayLocation` → `hint` (InlineSuggestHint)

   - `src/vs/editor/contrib/inlineCompletions/browser/model/inlineSuggestionItem.ts:362`

   ```typescript
   const hint = data.hint ? InlineSuggestHint.create(data.hint) : undefined;
   ```

2. **Storage**: Stored in `InlineSuggestionItemBase.hint`

3. **Rendering**:

   - Creates a custom view widget at `hint.range`
   - Displays `hint.content` as a label
   - Uses `hint.style` for styling
   - `hint.jumpToEdit` controls navigation behavior

4. **Target Range**: When `jumpToEdit: false`, `hint.range` becomes the `targetRange`:
   ```typescript
   public get targetRange(): Range {
       return this.hint?.range && !this.hint.jumpToEdit
           ? this.hint?.range
           : this.editRange;
   }
   ```

### Is it a separate UI element?

**Yes.** It's rendered as a separate widget in the gutter/editor, not as part of the inline completion ghost text.

### Requirements for displayLocation to work:

- ✅ `displayLocation.range` must be valid
- ✅ `displayLocation.label` must be provided
- ✅ The range must be visible in the viewport
- ✅ API must be enabled (`inlineCompletionsAdditions`)

---

## 4. Filtering and Validation

### Filtering logic for `isInlineEdit: true`:

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:502-509`

```typescript
for (const completion of c.inlineCompletions) {
	if (!completion.isInlineEdit) {
		if (completion.isVisible(this.textModel, cursorPosition)) {
			visibleCompletions.push(completion);
		}
	} else {
		inlineEdit = completion; // No filtering applied!
	}
}
```

**Current filtering checks:**

- ✅ `isInlineEdit: true` → selected
- ❌ **showRange** → **NOT CHECKED**
- ❌ Distance limits → **NOT CHECKED**
- ❌ Range validation → **NOT CHECKED**

### Distance limits or constraints:

**None for inline edits.** Regular completions have constraints (must be on same line as cursor), but inline edits bypass this.

### Does VS Code check if range is "too far" from cursor?

**No.** For inline edits, there's no distance check. The edit can be on any line.

---

## 5. Code Locations to Examine

### Inline completion provider result processing:

1. **Provider → Protocol**: `src/vs/workbench/api/common/extHostLanguageFeatures.ts:1371-1462`

   - Converts extension API to internal format

2. **Protocol → Data**: `src/vs/editor/contrib/inlineCompletions/browser/model/provideInlineCompletions.ts:167-253`

   - Creates `InlineSuggestData` from `InlineCompletion`

3. **Data → Item**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineSuggestionItem.ts:346-364`
   - Creates `InlineEditItem` from `InlineSuggestData`

### Inline completions filtered/validated:

**Location**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:496-521`

This is where filtering should happen but `showRange` is missing.

### Rendering logic:

1. **Model → View**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:617-636`
2. **View → UI**: `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsView.ts`
3. **Custom View**: `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsCustomView.ts`

### Where VS Code checks isInlineEdit, showRange, displayLocation:

- ✅ **isInlineEdit**: Checked in `inlineCompletionsModel.ts:503`
- ❌ **showRange**: **NOT CHECKED ANYWHERE**
- ✅ **displayLocation**: Converted to `hint` in `inlineSuggestionItem.ts:362`, used in rendering

---

## 6. Specific Issues

### If suggestion has range on line 5, cursor on line 1, showRange includes lines 1-9:

**Expected behavior** (if `showRange` were implemented):

- ✅ Should display (cursor on line 1 is within showRange 1-9)

**Actual behavior** (current):

- ✅ Displays (showRange is ignored, so it always displays if no regular completion is visible)

### What happens if range and cursor are on different lines?

**For inline edits**: No problem. The edit can be on any line, regardless of cursor position.

**For regular completions**: They must be on the same line as the cursor (checked in `inlineCompletionIsVisible`).

### Console errors/warnings when properties used incorrectly?

**No.** VS Code silently ignores `showRange` without warnings.

---

## 7. Example Scenario

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

### If cursor is on line 3, should this suggestion appear?

**Expected**: ✅ Yes (cursor on line 3 is within showRange 1-9)

**Actual**: ✅ Yes (but showRange is ignored, so it appears regardless)

### What would prevent it from appearing?

1. ❌ **showRange check** - Not implemented, so doesn't prevent
2. ✅ **Context**: `context.includeInlineEdits` must be `true`
3. ✅ **Precedence**: No visible regular inline completions
4. ✅ **Peek widgets**: No visible peek widgets
5. ✅ **API enabled**: `inlineCompletionsAdditions` API must be enabled

---

## Root Cause Summary

**The `showRange` property is not implemented in VS Code's filtering logic.**

The property:

- ✅ Is defined in the API
- ✅ Is passed through the protocol
- ✅ Is stored in `sourceInlineCompletion`
- ❌ **Is never checked before displaying inline edits**

This is why your suggestions aren't appearing as expected - they're being created, but `showRange` filtering isn't working.

---

## Workaround

Until `showRange` is implemented, you can:

1. **Filter in your provider**:

   ```typescript
   provideInlineCompletions(document, position, context) {
       // Only return items when cursor is in desired range
       const showRange = new Range(1, 0, 9, Number.MAX_SAFE_INTEGER);
       if (!showRange.contains(position)) {
           return { items: [] };
       }
       // ... return your items
   }
   ```

2. **Re-request on cursor movement**: You'll need to trigger updates when cursor moves in/out of range.

3. **File an issue**: Report this missing feature to VS Code team.

---

## Files to Examine

- **Filtering**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineCompletionsModel.ts:496-521`
- **Item creation**: `src/vs/editor/contrib/inlineCompletions/browser/model/inlineSuggestionItem.ts:346-364`
- **Protocol**: `src/vs/workbench/api/common/extHostLanguageFeatures.ts:1431`
- **Rendering**: `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsView.ts`
- **Display location**: `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsCustomView.ts`

---

## Proposed APIs: Control Logic and Enabling

### Where is the logic that controls whether to enable experimental proposed APIs?

**Location**: `src/vs/workbench/services/extensions/common/extensionsProposedApi.ts`

The main class is `ExtensionsProposedApi`, which determines whether proposed APIs are enabled for each extension. The key logic is in the constructor (lines 34-37):

```typescript
this._envEnablesProposedApiForAll =
	!_environmentService.isBuilt || // always allow proposed API when running out of sources
	(_environmentService.isExtensionDevelopment &&
		productService.quality !== "stable") || // do not allow proposed API against stable builds when developing an extension
	(this._envEnabledExtensions.size === 0 &&
		Array.isArray(_environmentService.extensionEnabledProposedApi)); // always allow proposed API if --enable-proposed-api is provided without extension ID
```

### How is `isBuilt` determined?

The `isBuilt` property determines whether VS Code is running from sources or from a built/release version:

1. **Native (Electron) builds** (`src/vs/platform/environment/common/environmentService.ts:210`):

   ```typescript
   get isBuilt(): boolean { return !env['VSCODE_DEV']; }
   ```

   - If `VSCODE_DEV` environment variable is set → `isBuilt = false` (running from sources)
   - If `VSCODE_DEV` is not set → `isBuilt = true` (built/release version)

2. **Browser builds** (`src/vs/workbench/services/environment/browser/environmentService.ts:55`):
   ```typescript
   get isBuilt(): boolean { return !!this.productService.commit; }
   ```
   - If `productService.commit` exists → `isBuilt = true` (built version)
   - If `productService.commit` is missing → `isBuilt = false` (running from sources)

### Why does release build of VS Code not have proposed APIs, while OSS build has?

**The difference is NOT between release vs OSS builds, but between built vs development builds:**

1. **When `isBuilt = false`** (running from sources):

   - Line 35: `!_environmentService.isBuilt` evaluates to `true`
   - `_envEnablesProposedApiForAll = true`
   - **All extensions can use proposed APIs** (as declared in their `package.json`)

2. **When `isBuilt = true`** (release/built build):
   - Line 35: `!_environmentService.isBuilt` evaluates to `false`
   - Proposed APIs are **disabled by default** unless:
     - Extension is listed in `product.json#extensionEnabledApiProposals` (lines 80-101)
     - Extension is explicitly enabled via `--enable-proposed-api` command line flag (line 104)
     - Running in extension development mode against non-stable builds (line 36)

**Why this design?**

- Proposed APIs are experimental and unstable
- Microsoft wants to control which extensions use them in production builds
- Running from sources is considered a development environment where proposed APIs are safe to use

### How can we enable some proposed API so that it will be available for all extensions in our custom VS Code build?

There are **three approaches** to enable proposed APIs for all extensions:

#### Option 1: Modify `product.json` (Recommended for specific extensions)

Add `extensionEnabledApiProposals` to your `product.json`:

```json
{
	"extensionEnabledApiProposals": {
		"your-extension-id": ["inlineCompletionsAdditions", "otherProposalName"],
		"*": ["inlineCompletionsAdditions"] // Note: "*" may not work, use specific IDs
	}
}
```

**Limitation**: This only works for extensions listed explicitly. You'd need to list all extension IDs.

#### Option 2: Modify the logic to always enable proposed APIs (For all extensions)

Modify `src/vs/workbench/services/extensions/common/extensionsProposedApi.ts`:

```typescript
// Line 34-37: Change to always enable proposed APIs
this._envEnablesProposedApiForAll = true; // Always allow proposed API
```

Or more safely, add a product.json flag:

1. Add to `product.json`:

   ```json
   {
   	"enableProposedApiForAll": true
   }
   ```

2. Modify `extensionsProposedApi.ts`:
   ```typescript
   this._envEnablesProposedApiForAll =
   	productService.enableProposedApiForAll || // NEW: product.json flag
   	!_environmentService.isBuilt ||
   	(_environmentService.isExtensionDevelopment &&
   		productService.quality !== "stable") ||
   	(this._envEnabledExtensions.size === 0 &&
   		Array.isArray(_environmentService.extensionEnabledProposedApi));
   ```

#### Option 3: Use command line flag (Runtime only)

Start VS Code with:

```bash
code --enable-proposed-api
```

This enables proposed APIs for all extensions, but only for that session.

**Note**: The logic at line 37 checks if `--enable-proposed-api` is provided without extension IDs, which enables it for all extensions.

**✅ Supported in Release Builds**: The `--enable-proposed-api` flag **IS supported in release builds**. The condition on line 37 is independent of `isBuilt`, so it works regardless of whether VS Code is running from sources or from a release build. This flag is specifically designed to enable proposed APIs in production builds when explicitly requested.

**Usage examples**:
- `code --enable-proposed-api` → Enables proposed APIs for **all extensions**
- `code --enable-proposed-api=my.extension.id` → Enables proposed APIs for **only that extension**
- `code --enable-proposed-api=ext1 --enable-proposed-api=ext2` → Enables for **multiple specific extensions**

### Summary of Proposed API Control Flow

```
Extension loads
    ↓
ExtensionsProposedApi.doUpdateEnabledApiProposals()
    ↓
Check priority:
1. Is extension in product.json#extensionEnabledApiProposals?
   → YES: Use proposals from product.json (overrides package.json)
   → NO: Continue
2. Is _envEnablesProposedApiForAll = true?
   → YES: Allow all proposals from package.json
   → NO: Continue
3. Is extension explicitly enabled via --enable-proposed-api?
   → YES: Allow all proposals from package.json
   → NO: Continue
4. Is extension builtin?
   → YES: Allow proposals (builtin extensions are trusted)
   → NO: REJECT - Clear enabledApiProposals array
```

### Where is `--enable-proposed-api` command line flag checked?

The `--enable-proposed-api` flag is parsed and checked at multiple points in the codebase:

#### 1. Command Line Argument Definition

**Location**: `src/vs/platform/environment/node/argv.ts:104`

```typescript
'enable-proposed-api': {
    type: 'string[]',
    allowEmptyValue: true,
    cat: 'e',
    args: 'ext-id',
    description: localize('experimentalApis', "Enables proposed API features for extensions. Can receive one or more extension IDs to enable individually.")
}
```

**Type Definition**: `src/vs/platform/environment/common/argv.ts:86`
```typescript
'enable-proposed-api'?: string[]; // undefined or array of 1 or more
```

#### 2. Main Process Handling (argv.json persistence)

**Location**: `src/main.ts:262-268`

Handles persistence of the flag via `argv.json`:

```typescript
case 'enable-proposed-api':
    if (Array.isArray(argvValue)) {
        argvValue.forEach(id => id && typeof id === 'string' && process.argv.push('--enable-proposed-api', id));
    } else {
        console.error(`Unexpected value for \`enable-proposed-api\` in argv.json. Expected array of extension ids.`);
    }
    break;
```

#### 3. Native (Electron) Environment Service

**Location**: `src/vs/workbench/services/environment/electron-sandbox/environmentService.ts:128-138`

Reads the parsed argument:

```typescript
@memoize
get extensionEnabledProposedApi(): string[] | undefined {
    if (Array.isArray(this.args['enable-proposed-api'])) {
        return this.args['enable-proposed-api'];
    }

    if ('enable-proposed-api' in this.args) {
        return []; // Empty array means "enable for all"
    }

    return undefined;
}
```

**Key behavior**:
- If `--enable-proposed-api` is provided **without extension IDs** → returns `[]` (empty array)
- If `--enable-proposed-api=extension.id` → returns `['extension.id']`
- If not provided → returns `undefined`

#### 4. Browser Environment Service

**Location**: `src/vs/workbench/services/environment/browser/environmentService.ts:200-206, 323-325`

Reads from the payload (for web/browser scenarios):

```typescript
get extensionEnabledProposedApi(): string[] | undefined {
    if (!this.extensionHostDebugEnvironment) {
        this.extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
    }
    return this.extensionHostDebugEnvironment.extensionEnabledProposedApi;
}

// In resolveExtensionHostDebugEnvironment():
case 'enableProposedApi':
    extensionHostDebugEnvironment.extensionEnabledProposedApi = [];
    break;
```

#### 5. Usage in Proposed API Logic

**Location**: `src/vs/workbench/services/extensions/common/extensionsProposedApi.ts:32, 34-37`

The flag is used to determine if proposed APIs should be enabled:

```typescript
this._envEnabledExtensions = new Set((_environmentService.extensionEnabledProposedApi ?? []).map(id => ExtensionIdentifier.toKey(id)));

this._envEnablesProposedApiForAll =
    !_environmentService.isBuilt ||
    (_environmentService.isExtensionDevelopment && productService.quality !== 'stable') ||
    (this._envEnabledExtensions.size === 0 && Array.isArray(_environmentService.extensionEnabledProposedApi));
    // ↑ This checks if flag was provided without extension IDs (empty array)
```

**Logic explanation**:
- If `extensionEnabledProposedApi` is `[]` (empty array) → `_envEnablesProposedApiForAll = true` (enables for all extensions)
- If `extensionEnabledProposedApi` is `['ext.id']` → only that extension is added to `_envEnabledExtensions` set
- If `extensionEnabledProposedApi` is `undefined` → flag was not provided

#### 6. Extension-Specific Check

**Location**: `src/vs/workbench/services/extensions/common/extensionsProposedApi.ts:104`

When processing each extension:

```typescript
if (this._envEnablesProposedApiForAll || this._envEnabledExtensions.has(key)) {
    // proposed API usage is not restricted and allowed just like the extension has declared it
    return;
}
```

### Complete Flow Diagram

```
Command Line: --enable-proposed-api [ext-id]
    ↓
argv.ts: Parse into NativeParsedArgs['enable-proposed-api']
    ↓
main.ts: Handle argv.json persistence (optional)
    ↓
Environment Service:
  - Electron: environmentService.ts reads this.args['enable-proposed-api']
  - Browser: environmentService.ts reads from payload
    ↓
ExtensionsProposedApi constructor:
  - If empty array [] → _envEnablesProposedApiForAll = true
  - If ['ext.id'] → add to _envEnabledExtensions set
  - If undefined → no special handling
    ↓
doUpdateEnabledApiProposals():
  - Check _envEnablesProposedApiForAll → enable for all
  - Check _envEnabledExtensions.has(extId) → enable for specific extension
```

### Key Files

- **Argument definition**: `src/vs/platform/environment/node/argv.ts` (line 104)
- **Type definition**: `src/vs/platform/environment/common/argv.ts` (line 86)
- **Main process handling**: `src/main.ts` (lines 262-268)
- **Native environment**: `src/vs/workbench/services/environment/electron-sandbox/environmentService.ts` (lines 128-138)
- **Browser environment**: `src/vs/workbench/services/environment/browser/environmentService.ts` (lines 200-206, 323-325)
- **Main logic**: `src/vs/workbench/services/extensions/common/extensionsProposedApi.ts` (lines 32, 34-37, 104)
- **Product configuration**: `src/vs/base/common/product.ts` (line 181)
