# Backport Plan: VS Code 1.100.0 Inline Completions to 1.96

## Overview
Backporting inline completions implementation from VS Code 1.100.0 to the `inline-completions-api-2` branch (based on 1.96).

## Phase 0: Dependencies ✅ SIMPLE

### Step 0.1: Create IObservableWithChange Type Alias
**Status**: Ready to implement

**Solution**: In 1.96, `IObservable<T, TChange>` already has the TChange parameter, so we just need a type alias:

```typescript
// Add to src/vs/base/common/observableInternal/base.ts or create adapter file
export type IObservableWithChange<T, TChange = unknown> = IObservable<T, TChange>;
```

**Files to modify**:
- Create: `src/vs/base/common/observableInternal/compatibility.ts` (or add to base.ts)

---

## Phase 1: View Architecture

### Step 1.1: Port View Interface Files
**Files to port from 1.100.0**:
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViewInterface.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditWithChanges.ts`

### Step 1.2: Port View Model
**Files to port**:
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsModel.ts`

### Step 1.3: Port View Components
**Files to port**:
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsCollapsedView.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsCustomView.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsDeletionView.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsInsertionView.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsLineReplacementView.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsSideBySideView.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsWordInsertView.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/inlineEditsWordReplacementView.ts` ✅ **Your requested feature!**
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/originalEditorInlineDiffView.ts`

### Step 1.4: Port View Producer
**Files to port**:
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViewProducer.ts`

### Step 1.5: Port Main View
**Files to port**:
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsView.ts`

### Step 1.6: Port Supporting Files
**Files to port**:
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/components/gutterIndicatorView.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/components/gutterIndicatorMenu.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/components/indicatorView.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/utils/utils.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/theme.ts`
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/view.css`

---

## Phase 2: Model Updates

### Step 2.1: Update inlineCompletionsModel.ts
**Changes**:
- Update constructor signature to use `IObservableWithChange` (via type alias)
- Port new state management observables
- Port undo/redo improvements
- Port collapsed mode logic
- Port viewport awareness
- Port enhanced tab action logic

### Step 2.2: Update inlineCompletionsSource.ts
**Changes**:
- Port provider change handling
- Port new request context fields

### Step 2.3: Update provideInlineCompletions.ts
**Changes**:
- Port new context fields
- Port request info structure

---

## Phase 3: Integration & Testing

### Step 3.1: Update Controller
**Files to update**:
- `src/vs/editor/contrib/inlineCompletions/browser/controller/inlineCompletionsController.ts`
- Update to use new view architecture

### Step 3.2: Update View Integration
**Files to update**:
- `src/vs/editor/contrib/inlineCompletions/browser/view/inlineCompletionsView.ts`
- Integrate new inline edits view

### Step 3.3: Testing
- Unit tests
- Integration tests
- Manual testing

---

## Implementation Order

1. ✅ **Phase 0**: Type alias (5 minutes)
2. **Phase 1**: View architecture (1 week)
3. **Phase 2**: Model updates (1 week)
4. **Phase 3**: Integration (3-5 days)

---

## Key Files Reference

### From 1.100.0 (Source)
- Base: `/Users/Anatoly.Nikitin/Workspace/vscode2` (checked out at 1.100.0)

### To 1.96 (Target)
- Base: `/Users/Anatoly.Nikitin/Workspace/vscode` (on `inline-completions-api-2` branch)

