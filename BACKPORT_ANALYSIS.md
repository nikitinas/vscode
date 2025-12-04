# Analysis: Backporting Inline Completions from VS Code 1.105 to 1.96

## Executive Summary

**Feasibility**: ⚠️ **Moderately Complex** - The backport is technically possible but will require significant effort due to architectural differences, new dependencies, and API changes between versions.

**Estimated Impact**:

- **Files Affected**: ~50-70 files
- **New Dependencies**: 3-5 new services/interfaces
- **Breaking Changes**: Multiple API signature changes
- **Risk Level**: Medium-High

### ⚠️ CRITICAL BLOCKERS IDENTIFIED

1. **TextReplacement System** ❌

   - **Status**: Does NOT exist in 1.96
   - **Impact**: CRITICAL - Core data structure used throughout 1.105 implementation
   - **Action Required**: Must backport `TextReplacement` and related types BEFORE proceeding
   - **Files to Backport**:
     - `src/vs/editor/common/core/edits/textEdit.ts`
     - `src/vs/editor/common/core/edits/stringEdit.ts`
     - Related range utilities

2. **IObservableWithChange** ❌

   - **Status**: Does NOT exist in 1.96
   - **Impact**: Medium - Used for change tracking in model
   - **Action Required**: Use `IObservable` with manual change tracking or create adapter

3. **TextModelText & OffsetRange** ⚠️
   - **Status**: Needs verification
   - **Impact**: Medium - Used for text operations
   - **Action Required**: Verify existence, backport if needed

---

## Key Differences Between 1.96 and 1.105

### 1. **Core Data Structures**

#### 1.96 (Current Backport Base)

- Uses `SingleTextEdit` from `../../common/core/textEdit.js`
- Simple edit representation

#### 1.105 (Target)

- Uses `TextReplacement` from `../../common/core/edits/textEdit.js`
- More sophisticated edit system with:
  - `TextModelText` wrapper
  - `StringReplacement` for string-level operations
  - `OffsetRange` for offset-based ranges
  - Better handling of parallel replacements

**Impact**: ⚠️ **High** - Core data structure change affects all edit operations

---

### 2. **New Service: IInlineCompletionsService**

#### What's New in 1.105:

```typescript
// New service in 1.105
export interface IInlineCompletionsService {
	readonly onDidChangeIsSnoozing: Event<boolean>;
	snooze(durationMs?: number): void;
	isSnoozing(): boolean;
	reportNewCompletion(requestUuid: string): void;
}
```

**Location**: `src/vs/editor/browser/services/inlineCompletionsService.ts`

**Purpose**:

- Snoozing functionality for inline completions
- Telemetry tracking
- Context key management

**Impact**: ⚠️ **Medium** - New service needs to be ported and registered

---

### 3. **View Architecture Refactoring**

#### 1.96 Structure:

```
view/inlineEdits/
  - inlineEditsView.ts (monolithic)
  - inlineEditsViewAndDiffProducer.ts
  - inlineEditsIndicatorView.ts
  - inlineDiffView.ts
  - utils.ts
```

#### 1.105 Structure:

```
view/inlineEdits/
  - inlineEditsView.ts (orchestrator)
  - inlineEditsModel.ts (new)
  - inlineEditsViewInterface.ts (new)
  - inlineEditsViewProducer.ts (new)
  - inlineEditWithChanges.ts (new)
  - components/
    - gutterIndicatorView.ts (new)
    - gutterIndicatorMenu.ts (new)
    - indicatorView.ts (new)
  - inlineEditsViews/ (new directory)
    - inlineEditsCollapsedView.ts
    - inlineEditsCustomView.ts
    - inlineEditsDeletionView.ts
    - inlineEditsInsertionView.ts
    - inlineEditsLineReplacementView.ts
    - inlineEditsSideBySideView.ts
    - inlineEditsWordInsertView.ts
    - inlineEditsWordReplacementView.ts
    - originalEditorInlineDiffView.ts
  - utils/
    - utils.ts
```

**Impact**: ⚠️ **Very High** - Complete architectural refactoring

**Key Changes**:

- Separation of concerns: Model vs View
- Modular view components for different edit types
- New view selection logic
- Better abstraction layers

---

### 4. **Model Changes**

#### Key Differences in `inlineCompletionsModel.ts`:

**1.96**:

- ~807 lines
- Uses `SingleTextEdit`
- Simpler state management
- Basic inline edit support

**1.105**:

- ~1219 lines (+51% more code)
- Uses `TextReplacement`
- More sophisticated state management:
  - `_appearedInsideViewport` observable
  - `_didUndoInlineEdits` tracking
  - `_lastShownInlineCompletionInfo` tracking
  - `_lastAcceptedInlineCompletionInfo` tracking
- New features:
  - `showCollapsed` observable
  - `tabAction` logic improvements
  - `inAcceptFlow` observable
  - `warning` observable
  - Better undo/redo handling
  - Provider change handling
  - Snoozing integration

**Impact**: ⚠️ **Very High** - Core model logic significantly enhanced

---

### 5. **API Changes**

#### InlineCompletion Interface:

**1.96**:

```typescript
export interface InlineCompletion {
	readonly insertText: string | { snippet: string };
	readonly range?: IRange;
	readonly isInlineEdit?: boolean;
	readonly showRange?: IRange;
	readonly hint?: InlineCompletionHint;
	// ... other fields
}
```

**1.105**:

```typescript
export interface InlineCompletion {
	readonly insertText: string | { snippet: string } | undefined; // Can be undefined
	readonly range?: IRange;
	readonly uri?: UriComponents; // Moved up
	readonly command?: Command;
	readonly gutterMenuLinkAction?: Command;
	// ... hint renamed/restructured
	// ... new fields
}
```

**Impact**: ⚠️ **Medium** - API signature changes, but mostly additive

---

### 6. **New Features in 1.105**

#### A. Collapsed Mode Improvements

- Better collapsed state management
- `showCollapsed` observable
- Improved UX for collapsed inline edits

#### B. Viewport Awareness

- `_appearedInsideViewport` tracking
- Better handling of suggestions outside viewport
- Improved scroll behavior

#### C. Undo/Redo Handling

- `_didUndoInlineEdits` tracking
- Better restoration of inline edits after undo
- `_lastShownInlineCompletionInfo` tracking

#### D. Provider Change Handling

- `onDidChangeInlineCompletions` support
- `_fetchSpecificProviderSignal` for targeted updates
- Better provider lifecycle management

#### E. Snoozing Integration

- Integration with `IInlineCompletionsService`
- Context-aware suppression

#### F. Enhanced Tab Action Logic

- More sophisticated `tabShouldJumpToInlineEdit`
- More sophisticated `tabShouldAcceptInlineEdit`
- `tabAction` observable

#### G. Animation Support

- `FadeoutDecoration` class
- Animation support for accepted edits

#### H. Better Edit Handling

- `removeTextReplacementCommonSuffixPrefix` for ghost text
- Better secondary edit handling
- Improved multi-cursor support

**Impact**: ⚠️ **High** - Many new features to port

---

### 7. **Dependencies**

#### New Dependencies in 1.105:

1. **IInlineCompletionsService** - New service
2. **IAccessibilityService** - For motion reduction
3. **ICodeEditorService** - For editor management
4. **ILanguageFeaturesService** - Enhanced usage
5. **TextModelText** - New text model wrapper
6. **OffsetRange** - New range type
7. **StringReplacement** - New edit type
8. **AnimatedValue, ObservableAnimatedValue** - Animation support
9. **TypingInterval** - Typing speed tracking

**Impact**: ⚠️ **Medium** - Need to verify all dependencies exist in 1.96

---

### 8. **Observable System Changes**

#### 1.105 Uses:

- `IObservableWithChange` instead of `IObservable` for version tracking
- `mapObservableArrayCached` for provider arrays
- More sophisticated derived observables
- Better change tracking

**Impact**: ⚠️ **Medium** - Need to verify observable API compatibility

---

## Detailed File-by-File Analysis

### Core Model Files

| File                          | 1.96 Lines | 1.105 Lines | Change | Complexity |
| ----------------------------- | ---------- | ----------- | ------ | ---------- |
| `inlineCompletionsModel.ts`   | 807        | 1219        | +51%   | Very High  |
| `inlineCompletionsSource.ts`  | ~400       | ~600        | +50%   | High       |
| `provideInlineCompletions.ts` | ~150       | ~200        | +33%   | Medium     |
| `inlineSuggestionItem.ts`     | N/A        | ~400        | New    | High       |

### View Files

| File                          | 1.96 | 1.105   | Change | Complexity |
| ----------------------------- | ---- | ------- | ------ | ---------- |
| `inlineEditsView.ts`          | 547  | 764     | +40%   | Very High  |
| View components               | 0    | 8 files | New    | High       |
| `inlineEditsModel.ts`         | N/A  | ~300    | New    | Medium     |
| `inlineEditsViewInterface.ts` | N/A  | ~70     | New    | Low        |

### Service Files

| File                          | 1.96 | 1.105 | Change | Complexity |
| ----------------------------- | ---- | ----- | ------ | ---------- |
| `inlineCompletionsService.ts` | N/A  | 253   | New    | Medium     |

---

## Migration Strategy

### Phase 1: Foundation (Low Risk)

1. ✅ Port `IInlineCompletionsService` and implementation
2. ✅ Port `inlineEditsViewInterface.ts` (interfaces only)
3. ✅ Verify all dependencies exist in 1.96

### Phase 2: Data Structures (High Risk) ⚠️ **CRITICAL BLOCKER**

1. ❌ **MUST** Port `TextReplacement` and related types from 1.105
   - This is a **hard dependency** - cannot proceed without it
   - Includes: `TextReplacement`, `StringReplacement`, `BaseStringEdit`
   - Location: `src/vs/editor/common/core/edits/textEdit.ts` and `stringEdit.ts`
2. ❌ Update all `SingleTextEdit` usages to `TextReplacement`
   - Affects: `inlineCompletionsModel.ts`, `provideInlineCompletions.ts`, and others
3. ⚠️ Port `TextModelText` wrapper if needed
   - Check if exists, if not, port from `src/vs/editor/common/core/text/abstractText.js`
4. ⚠️ Port `OffsetRange` if needed
   - Check if exists, if not, port from `src/vs/editor/common/core/ranges/offsetRange.js`

### Phase 3: Model Updates (High Risk)

1. ⚠️ Update `inlineCompletionsModel.ts` with new features
2. ⚠️ Port new state management observables
3. ⚠️ Port undo/redo handling
4. ⚠️ Port provider change handling
5. ⚠️ Integrate snoozing

### Phase 4: View Refactoring (Very High Risk)

1. ⚠️ Port new view architecture
2. ⚠️ Port modular view components
3. ⚠️ Port view selection logic
4. ⚠️ Port animation support

### Phase 5: Integration & Testing (High Risk)

1. ⚠️ Integration testing
2. ⚠️ Fix compatibility issues
3. ⚠️ Performance testing
4. ⚠️ UX validation

---

## Risk Assessment

### High Risk Areas

1. **Data Structure Migration** (Risk: **CRITICAL** - Blocker)

   - ❌ `TextReplacement` **DOES NOT EXIST** in 1.96
   - Must backport entire `TextReplacement` system from 1.105
   - Changing from `SingleTextEdit` to `TextReplacement` affects all edit operations
   - May require changes in other parts of the codebase
   - Risk of breaking existing functionality
   - **This is a hard blocker** - cannot proceed without backporting TextReplacement first

2. **View Architecture Refactoring** (Risk: Very High)

   - Complete restructuring of view layer
   - Many new files and components
   - Complex view selection logic

3. **Observable System** (Risk: Medium)

   - Different observable APIs
   - Need to verify compatibility
   - May require adapter layer

4. **Dependencies** (Risk: Medium)
   - Some dependencies may not exist in 1.96
   - May need to backport dependencies first
   - Or create compatibility shims

### Medium Risk Areas

1. **New Service Integration** (Risk: Medium)

   - New service needs registration
   - May affect other parts of the system

2. **API Changes** (Risk: Medium)
   - API signature changes
   - Need to maintain backward compatibility
   - Extension API considerations

### Low Risk Areas

1. **Interface Definitions** (Risk: Low)

   - Mostly additive changes
   - Easy to port

2. **Utility Functions** (Risk: Low)
   - Self-contained
   - Easy to test

---

## Compatibility Concerns

### 1. Observable API Compatibility

- **Issue**: 1.105 uses `IObservableWithChange` which **DOES NOT EXIST** in 1.96
- **Solution**:
  - Use `IObservable` with manual change tracking
  - Create adapter wrapper if needed
  - Or modify code to work with existing observable patterns

### 2. Text Edit API Compatibility ⚠️ **CRITICAL BLOCKER**

- **Issue**: `TextReplacement` **DOES NOT EXIST** in 1.96
- **Verified**: Confirmed - 1.96 uses `SingleTextEdit`, 1.105 uses `TextReplacement`
- **Solution**:
  - ✅ **Option A (Required)**: Backport `TextReplacement` and related types from 1.105
    - Files to backport:
      - `src/vs/editor/common/core/edits/textEdit.ts`
      - `src/vs/editor/common/core/edits/stringEdit.ts`
      - Related range utilities
  - ⚠️ Option B: Create adapter layer (not recommended - adds complexity)
  - ❌ Option C: Use `SingleTextEdit` with compatibility shim (not feasible - too many differences)

### 3. Service Registration

- **Issue**: Service registration pattern may differ
- **Solution**: Verify registration pattern in 1.96

### 4. Editor Options

- **Issue**: New editor options may not exist
- **Solution**: Add new options or use defaults

---

## Estimated Effort

### Conservative Estimate

- **Phase 1 (Foundation)**: 2-3 days
- **Phase 2 (Data Structures)**: 5-7 days
- **Phase 3 (Model Updates)**: 7-10 days
- **Phase 4 (View Refactoring)**: 10-14 days
- **Phase 5 (Integration & Testing)**: 5-7 days

**Total**: 29-41 days (~6-8 weeks)

### Optimistic Estimate (if dependencies exist)

- **Phase 1**: 1-2 days
- **Phase 2**: 3-5 days
- **Phase 3**: 5-7 days
- **Phase 4**: 7-10 days
- **Phase 5**: 3-5 days

**Total**: 19-29 days (~4-6 weeks)

---

## Recommendations

### Option 1: Full Backport (Recommended if time permits)

**Pros**:

- Complete feature parity with 1.105
- Better UX and performance
- Future-proof

**Cons**:

- High effort (6-8 weeks)
- High risk
- May require backporting dependencies

### Option 2: Selective Backport (Recommended for faster delivery)

**Pros**:

- Lower effort (3-4 weeks)
- Lower risk
- Can prioritize critical features

**Cons**:

- Not complete feature parity
- May need to revisit later

**Recommended Features to Prioritize**:

1. ✅ Collapsed mode improvements
2. ✅ Better undo/redo handling
3. ✅ Viewport awareness
4. ✅ Enhanced tab action logic
5. ⚠️ Skip: Full view refactoring (use simplified version)
6. ⚠️ Skip: Animation support (nice-to-have)

### Option 3: Incremental Backport

**Pros**:

- Lower risk per phase
- Can test incrementally
- Can stop at any point

**Cons**:

- Longer overall timeline
- May have intermediate states that don't work well

**Approach**:

1. Start with Phase 1 & 2
2. Test thoroughly
3. Continue with Phase 3
4. Evaluate before Phase 4

---

## Critical Dependencies to Verify

**VERIFIED STATUS** (as of analysis):

1. ❌ `IObservableWithChange` - **DOES NOT EXIST** in 1.96

   - **Impact**: Need to use `IObservable` with manual change tracking
   - **Solution**: Create adapter or use existing observable patterns

2. ❌ `TextReplacement` - **DOES NOT EXIST** in 1.96

   - **Location in 1.105**: `src/vs/editor/common/core/edits/textEdit.ts`
   - **Location in 1.96**: Uses `SingleTextEdit` in `src/vs/editor/common/core/textEdit.ts`
   - **Impact**: **CRITICAL** - Core data structure change
   - **Solution**: Must backport `TextReplacement` and related types from 1.105

3. ⚠️ `TextModelText` - **NEEDS VERIFICATION**

   - **Location in 1.105**: `src/vs/editor/common/core/text/abstractText.js`
   - **Impact**: Used for text model operations
   - **Solution**: May need to backport if doesn't exist

4. ⚠️ `OffsetRange` - **NEEDS VERIFICATION**

   - **Location in 1.105**: `src/vs/editor/common/core/ranges/offsetRange.js`
   - **Impact**: Used for offset-based range operations
   - **Solution**: May need to backport if doesn't exist

5. ✅ `IAccessibilityService` - **EXISTS** in 1.96

   - **Status**: Confirmed present

6. ✅ `ICodeEditorService` - **EXISTS** in 1.96

   - **Status**: Confirmed present

7. ✅ `ILanguageFeaturesService` - **EXISTS** in 1.96

   - **Status**: Confirmed present (used in inlineCompletionsSource.ts)

8. ⚠️ Animation utilities (`AnimatedValue`, `ObservableAnimatedValue`) - **NEEDS VERIFICATION**
   - **Impact**: Used for fadeout animations
   - **Solution**: May need to backport or create simple implementation

---

## Testing Strategy

### Unit Tests

- Test all new model logic
- Test view components individually
- Test data structure conversions

### Integration Tests

- Test end-to-end inline completion flow
- Test undo/redo scenarios
- Test provider changes
- Test snoozing functionality

### Manual Testing

- Test UX matches 1.105
- Test performance
- Test edge cases
- Test with various providers

---

## Conclusion

The backport is **feasible but complex**. The main challenges are:

1. **Architectural differences** - Significant refactoring in view layer
2. **Data structure changes** - Core edit representation changed
3. **New dependencies** - Several new services and utilities
4. **Feature additions** - Many new features to port

**Recommendation**:

- If you need **complete feature parity**: Plan for 6-8 weeks
- If you need **core improvements**: Plan for 3-4 weeks with selective backport
- Consider **incremental approach** to reduce risk

**Next Steps**:

1. Verify all dependencies exist in 1.96
2. Create a detailed migration plan
3. Set up a test branch
4. Start with Phase 1 (low risk)
5. Evaluate after each phase

---

## Appendix: File Count Comparison

### 1.96 Inline Completions Files

- Model: ~5 files
- View: ~8 files
- Controller: ~2 files
- Utils: ~3 files
- **Total**: ~18 files

### 1.105 Inline Completions Files

- Model: ~8 files
- View: ~20 files (including components)
- Controller: ~2 files
- Service: ~1 file
- Utils: ~5 files
- **Total**: ~36 files

**Increase**: ~100% more files
