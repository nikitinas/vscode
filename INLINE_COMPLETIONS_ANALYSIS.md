# Analysis: Inline Completions Presentation Changes (Last Year)

## Executive Summary

Over the past year, VS Code's inline completions (Next Edit Suggestions/NES) presentation has undergone significant evolution, moving from basic inline diff rendering to a sophisticated multi-view system with long-distance hints, collapsed modes, and specialized views for different edit types. The changes were driven by user experience improvements, performance optimizations, and the need to handle more complex editing scenarios.

---

## Major Changes Timeline

### Phase 1: Foundation & View Refactoring (Dec 2024 - Mar 2025)

#### Key Commits:

- **Dec 2024**: `inline edit should never overlap cursor (#235280)` - Fixed cursor overlap issues
- **Dec 2024**: `Remove default background colors and allow to style the borders independently (#235847)` - Improved visual styling
- **Dec 2024**: `inline edit view refactoring (#235836)` - Major refactoring of view structure
- **Feb 2025**: `Inline edit file structure refactoring (#240799)` - Reorganized file structure

**Reasoning**:

- Established a solid foundation for multiple view types
- Separated concerns between different rendering strategies
- Improved maintainability and extensibility

**User Impact**:

- More consistent visual appearance
- Better separation of different edit types
- Foundation for future enhancements

---

### Phase 2: Interactive Features & Collapsed Mode (Feb - Mar 2025)

#### Key Commits:

- **Feb 19, 2025**: `Implements mouse interaction with inline edit insertions (#241211)` - Made widgets clickable
- **Feb 19, 2025**: `Show suggestion on hover in collapsed mode (#241222)` - Hover preview in collapsed state
- **Feb 20, 2025**: `clickable/hoverable ghosttext view (#241399)` - Enhanced interactivity
- **Feb 21, 2025**: `Make all widgets clickable and align (#241453)` - Unified interaction model
- **Mar 16, 2025**: `Go into collapsed mode when typing (#243691)` - Auto-collapse during typing
- **Mar 21, 2025**: `Add collapsed indicator for inline edits view (#244270)` - Visual collapsed indicator

**Reasoning**:

- **Reduced visual clutter**: Collapsed mode prevents suggestions from blocking the editor while typing
- **Progressive disclosure**: Users can hover to preview without fully expanding
- **Better focus management**: Typing automatically collapses suggestions to avoid distraction
- **Accessibility**: Clickable widgets provide clear interaction affordances

**User Impact**:

- ✅ Less intrusive editing experience
- ✅ Suggestions don't block view while actively typing
- ✅ Easy preview on hover without committing
- ✅ Clear visual indicators for collapsed state

---

### Phase 3: Specialized View Types (Mar - May 2025)

#### Key Commits:

- **Mar 12, 2025**: `insertion view init order fix (#243316)` - Fixed insertion view initialization
- **Mar 27, 2025**: `Very precise side by side width approximation (#244899)` - Improved side-by-side layout
- **Apr 9, 2025**: `NES: support alternative display locations (#246122)` - Custom display locations
- **Apr 10, 2025**: `Cleanup display ranges and support alternative display ranges (#246196)` - Enhanced display range handling
- **May 22, 2025**: `Fix cut-off edit suggestions in the editor and rendering after minimap (#249537)` - Fixed rendering issues

**Reasoning**:

- **Context-aware rendering**: Different edit types (insertions, deletions, word replacements) need different visual representations
- **Flexibility**: Alternative display locations allow providers to show suggestions where they're most relevant
- **Precision**: Better width calculations prevent cut-off content
- **Viewport awareness**: Suggestions adapt to available space

**User Impact**:

- ✅ More appropriate visual representation for different edit types
- ✅ Suggestions appear in contextually relevant locations
- ✅ No more cut-off content
- ✅ Better use of available screen space

---

### Phase 4: Display Location & Hint System (Apr - Oct 2025)

#### Key Commits:

- **Apr 9, 2025**: `NES: support alternative display locations (#246122)` - Initial alternative locations
- **Jul 11, 2025**: `display location more dynamic (#255449)` - Dynamic display location updates
- **Oct 27, 2025**: `Allows insertText to be empty, introduces URI and renames DisplayLocation to Hint. (#273125)` - **Major API change**

**Reasoning**:

- **API Evolution**: Renamed `DisplayLocation` to `Hint` to better reflect its purpose as a hint/indicator rather than a strict display requirement
- **Multi-document support**: URI support enables suggestions across different files
- **Empty edits**: Support for suggestions that don't modify text (e.g., refactoring hints)
- **Semantic clarity**: "Hint" better describes the non-binding nature of the location

**User Impact**:

- ✅ More flexible suggestion placement
- ✅ Support for cross-file suggestions
- ✅ Clearer API semantics for extension developers
- ⚠️ Breaking change for extensions (DisplayLocation → Hint)

---

### Phase 5: Long Distance Hints (Nov 2025) - **Major Feature**

#### Key Commits:

- **Nov 12, 2025**: `Long Distance Hints (#274700)` - **Initial implementation**
- **Nov 14, 2025**: `Improved NES long distance hint (#277262)` - Improvements
- **Nov 18, 2025**: `NES long distance hint: improved preview editor scroll position` - Scroll position fixes
- **Nov 18, 2025**: `Long Distance Hint Mouse interaction improvements` - Better mouse handling
- **Nov 18, 2025**: `Do not show hint after jumping to it` - UX refinement
- **Nov 21, 2025**: `Small tweaks to long distance hint` - Polish
- **Nov 26, 2025**: `Add long distance hint telemetry to inline completions` - Telemetry
- **Nov 27, 2025**: `Add long distance hint telemetry to inline completion end-of-life events (#279564)` - More telemetry
- **Dec 1, 2025**: `Disable the jump to decoration in the long distance view (#280331)` - UX refinement

**Reasoning**:

- **Problem**: When suggestions are far from the cursor (outside viewport), users couldn't see them
- **Solution**: Long-distance hints show a compact indicator near the cursor that:
  - Shows where the suggestion is located
  - Provides a preview of the edit
  - Allows jumping to the suggestion location
  - Only appears when the suggestion is outside the viewport

**Technical Implementation**:

- New `InlineEditsLongDistanceHint` view component
- Preview editor showing the suggested changes
- Gutter indicator showing suggestion location
- Jump-to-position functionality
- Viewport detection to determine when to show hint vs. full view

**User Impact**:

- ✅ **Major UX improvement**: Users can now discover suggestions even when they're far from cursor
- ✅ Preview without scrolling
- ✅ Easy navigation to suggestion location
- ✅ Less disorienting than auto-scrolling to suggestions
- ✅ Better for large files with suggestions scattered throughout

---

### Phase 6: Rename UX Improvements (Nov - Dec 2025)

#### Key Commits:

- **Nov 26, 2025**: `Implements InlineCompletion.jumpToPosition (#279623)` - Jump-to-position API
- **Nov 26, 2025**: `improved rename rendering` - Better rename visualization
- **Nov 27, 2025**: `Improve rename layouting` - Layout improvements
- **Nov 30, 2025**: `New rename UX` - **Major UX overhaul**
- **Dec 1, 2025**: `rename widget fixes` - Bug fixes
- **Dec 1, 2025**: `tab to jump` - Keyboard shortcut for jumping

**Reasoning**:

- **Specialized handling**: Renames are a common and important edit type that benefit from specialized UI
- **Better visualization**: Renames need clear indication of what's being renamed and where
- **Improved workflow**: Jump-to-position allows quick navigation between rename locations
- **Consistency**: Unified UX for rename suggestions across the editor

**User Impact**:

- ✅ Better visual representation of rename operations
- ✅ Easier navigation between rename locations
- ✅ More intuitive rename suggestion workflow
- ✅ Keyboard shortcuts for power users

---

### Phase 7: Performance & Polish (Throughout 2025)

#### Key Commits:

- **Aug 26, 2025**: `Improve debugging for NES observables (#263460)` - Better debugging
- **Sep 20, 2025**: `Implements code-no-observable-get-in-reactive-context (#267526)` - Performance optimization
- **Oct 7, 2025**: `Try to not render above cursor when not allowing code shifting (#270152)` - Smart positioning
- **Nov 27, 2025**: `NES performance improvements (#279835)` - Performance work
- **Dec 1, 2025**: `Report handleInlineSuggestionShown after suggestion was actually rendered. (#280386)` - Accurate telemetry

**Reasoning**:

- **Performance**: Observable system optimizations reduce unnecessary re-renders
- **Smart positioning**: Avoid rendering above cursor when code shifting is disabled
- **Accurate metrics**: Better telemetry for understanding user behavior
- **Debugging**: Improved debugging tools for developers

**User Impact**:

- ✅ Faster rendering
- ✅ Less CPU usage
- ✅ Better positioning logic
- ✅ More accurate analytics for future improvements

---

## View Type Evolution

### Initial Views (Early 2025):

1. **Side-by-Side View**: Original and modified code side by side
2. **Word Replacement View**: Inline word-level replacements
3. **Insertion View**: Insertions at cursor
4. **Deletion View**: Deletions
5. **Line Replacement View**: Full line replacements

### Added Views:

6. **Collapsed View** (Mar 2025): Compact indicator when collapsed
7. **Custom View** (Apr 2025): Provider-defined custom rendering
8. **Long Distance Hint View** (Nov 2025): Indicator for out-of-viewport suggestions

### Removed/Deprecated Views:

- **Mixed Lines Diff View**: Removed in favor of more specific views
- **Interleaved Lines Diff View**: Removed for simplicity

---

## Key Architectural Changes

### 1. **Observable-Based Reactive System**

- Migrated to reactive observables for better performance
- Reduced unnecessary re-renders
- Better dependency tracking

### 2. **View Selection Logic**

- Simplified view selection algorithm
- Removed complex conditional logic for mixed/interleaved views
- More predictable view selection

### 3. **Model Separation**

- Separated `InlineEditModel` from view logic
- Better separation of concerns
- Easier testing and maintenance

### 4. **Display Location → Hint**

- Semantic rename for clarity
- Support for empty edits
- Multi-document support via URI

---

## User Experience Impact Summary

### Positive Changes:

1. ✅ **Less Intrusive**: Collapsed mode prevents blocking while typing
2. ✅ **More Discoverable**: Long-distance hints show suggestions anywhere in file
3. ✅ **Better Context**: Suggestions appear where they're relevant
4. ✅ **More Interactive**: Clickable widgets, hover previews
5. ✅ **Specialized Views**: Better representation for different edit types
6. ✅ **Performance**: Faster rendering, less CPU usage
7. ✅ **Accessibility**: Better keyboard navigation, clearer indicators

### Challenges Addressed:

1. ✅ **Cursor Overlap**: Fixed suggestions overlapping cursor
2. ✅ **Cut-off Content**: Fixed rendering issues with minimap
3. ✅ **Viewport Awareness**: Suggestions adapt to available space
4. ✅ **Multi-cursor Support**: Better handling of multiple cursors
5. ✅ **Focus Management**: Better handling of focus during interactions

### Potential Concerns:

1. ⚠️ **API Breaking Changes**: DisplayLocation → Hint rename
2. ⚠️ **Complexity**: More view types may be harder to understand
3. ⚠️ **Learning Curve**: New features require user education

---

## Technical Metrics & Telemetry

### Telemetry Added:

- Long-distance hint usage tracking
- View type selection tracking
- Rendering performance metrics
- User interaction patterns
- Suggestion acceptance rates

### Performance Improvements:

- Observable system optimizations
- Reduced re-renders
- Better caching strategies
- Optimized layout calculations

---

## Future Implications

### Based on Recent Changes:

1. **Continued Specialization**: More view types for specific scenarios (renames, refactorings)
2. **Better AI Integration**: Long-distance hints enable better AI suggestion placement
3. **Cross-File Suggestions**: URI support enables multi-file editing workflows
4. **Performance Focus**: Ongoing optimization work suggests performance is a priority

---

## Conclusion

The evolution of inline completions presentation over the past year represents a significant maturation of the feature, moving from basic inline diffs to a sophisticated, context-aware suggestion system. The changes have been driven by:

1. **User Experience**: Making suggestions less intrusive and more discoverable
2. **Performance**: Optimizing rendering and reactivity
3. **Flexibility**: Supporting more use cases and scenarios
4. **Developer Experience**: Better APIs and debugging tools

The introduction of long-distance hints and collapsed mode represent the most significant UX improvements, addressing key pain points around discoverability and visual clutter. The ongoing work on rename UX and performance optimizations shows continued investment in making inline completions a first-class editing experience.
