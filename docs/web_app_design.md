# IR Droplet - Web App Implementation Plan

## Overview

This document outlines the implementation plan for creating a browser-based web application that exposes all core functionality of the CLI-based `ir_average.py` tool. The web app will be a fully client-side implementation that allows users to drag and drop impulse response files to generate summary IRs with visualizations.

## Core Features to Implement

### 1. File Processing and Management
- Drag-and-drop interface for uploading IR files
- File validation (WAV format only)
- Support for multiple file selection
- Progress tracking during file processing

### 2. Core DSP Pipeline (Exact Parity with CLI)
- Sample rate validation and error handling
- File alignment using cross-correlation
- Tilt-based cohort selection (bright/dark/mids)
- Magnitude averaging with minimum-phase reconstruction
- Time-domain averaging method (timealign)
- Power/RMS weighting options

### 3. Visualization Features
- Magnitude response comparison plot (sources vs average)
- Dropped IRs visualization (dashed blue lines)
- Tilt band markers
- Interactive plot with readable frequency ticks
- Statistical annotations

### 4. Output Configuration
- Bit depth selection (16/24/32-bit float)
- Sample rate selection (Source/44.1k/48k/96k)
- Filename generation based on dropped files
- Save functionality (native picker when available, download fallback)

### 5. Error Handling and User Feedback
- Comprehensive error messages with file context
- Progress indicators during processing
- Clear warnings for misaligned files
- Graceful handling of edge cases

## Technical Implementation Approach

### Architecture Overview

The application will be structured as a single-page static web app using modern JavaScript (ES6+) with no build step. The core modules will be:

1. **`wav.js`** - Audio file decoding/encoding (RIFF/PCM support)
2. **`dsp.js`** - Core DSP processing (exact port of CLI algorithm)
3. **`resample.js`** - Sample rate conversion using Web Audio API
4. **`naming.js`** - Filename generation based on input files
5. **`plot.js`** - Canvas-based magnitude response plotting
6. **`app.js`** - Main application logic and UI orchestration

### File Structure

```
web/
├── index.html        # Main HTML layout
├── styles.css        # Styling for UI
├── wav.js            # Audio file I/O
├── dsp.js            # Core DSP processing
├── resample.js       # Sample rate conversion
├── naming.js         # Filename generation
├── plot.js           # Plotting functionality
└── app.js            # Main application logic
```

### Key Implementation Details

#### 1. File Processing (wav.js)
- Decode WAV files with RIFF/PCM support (16/24/32-bit int + 32-bit float)
- Preserve true sample rate
- Encode WAV files in desired bit depth
- Error handling for invalid files

#### 2. DSP Processing (dsp.js)
- **Exact parity with ir_average.py**:
  - Cross-correlation alignment
  - FFT and magnitude averaging
  - Minimum-phase reconstruction
  - Tilt-based cohort selection
  - Time-domain averaging option
  - Power/RMS weighting
- All mathematical operations must match the Python implementation within reasonable tolerance

#### 3. Visualization (plot.js)
- Canvas-based plotting
- Logarithmic frequency scale (20Hz-20kHz)
- Readable frequency tick labels
- Color-coded lines (grey sources, red average, blue dropped)
- Tilt band marker lines
- Responsive design

#### 4. Output Handling (app.js)
- Native File System Access API when available
- Download fallback for browsers without File System Access
- Filename generation based on input files and selection mode
- Output format configuration (bit depth, sample rate)

## Browser Compatibility Considerations

- **Secure context required**: HTTPS or localhost for File System Access API
- **Modern browsers only**: ES6+ features, Web Audio API, Canvas API
- **Progressive enhancement**: Core functionality works without advanced features
- **Graceful degradation**: Basic functionality available on older browsers

## Implementation Phases

### Phase 1: Core Architecture and File Processing
1. HTML/CSS layout and UI structure
2. Drag-and-drop file interface
3. WAV file decoding/encoding module
4. Basic file validation and error handling

### Phase 2: DSP Pipeline Implementation
1. Core DSP algorithms ported from Python
2. Cross-correlation alignment
3. Tilt-based cohort selection
4. Magnitude averaging and minimum-phase reconstruction

### Phase 3: Visualization and Output
1. Canvas-based plotting implementation
2. Output configuration UI
3. Save functionality (File System Access + download fallback)
4. Filename generation logic

### Phase 4: Enhanced Features and Testing
1. Performance optimization
2. Comprehensive error handling
3. Edge case testing
4. Browser compatibility verification

## Technical Specifications

### Required Browser APIs
- File API for reading files
- Web Audio API for audio processing
- Canvas API for plotting
- File System Access API for save functionality (progressive enhancement)
- ES6+ JavaScript features

### Data Flow
1. User drops files → File API reads files
2. WAV files decoded → Audio data extracted
3. DSP pipeline processes data → Summary IR generated
4. Visualization rendered → Plot displayed
5. User saves → File System Access or download

## Testing Strategy

### Unit Testing
- WAV decode/encode round-trip tests
- FFT against known transforms
- Tilt calculation accuracy
- Filename derivation tests

### Integration Testing
- Full DSP pipeline parity with Python reference
- User workflow testing (drop files → view plot → save)
- Error condition handling

### Browser Testing
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Performance Considerations

- Efficient memory usage for audio processing
- Optimized plotting algorithms
- Asynchronous processing to avoid UI blocking
- Pre-processing for large files when possible

## Security Considerations

- All processing happens in browser (no server uploads)
- Files never leave user's machine
- Sandboxed execution environment
- Input validation to prevent malformed data issues

## Future Enhancements (Post-MVP)

- Audition/preview functionality (convolving with guitar DI)
- Folder drop capability
- Batch processing mode
- Export to different formats
- Settings persistence
- Theme support

This implementation plan will create a fully functional, client-side web application that provides exact parity with the CLI tool's functionality while offering a more user-friendly interface for drag-and-drop operations.