import htmlContent from './record-button.html'
import './record-button.css'
import { configure, getConfig } from './capture-config'
import { drawWatermark } from './watermark'

const ACTIVE_TIMEOUT = 300
let captureMode = 'standard'

let status = 'waiting'
let activeTimeout = null
let isDown = false

// This is used to keep track of if the preview video has been generated, but the final video has
// not yet completed
let isWaitingOnFinal = false

let container
let flashElement
let progressBar

// Extract URL parameters and scene information
const getSceneInfo = () => {
  const params = new URLSearchParams(document.location.search.substring(1));
  const pColor = params.get('p') ? params.get('p') : '';
  const scene = pColor === 'r' ? 'receiver' : 'sender';
  const scenePrefix = scene === 'receiver' ? 'R' : 'S';

  return { pColor, scene, scenePrefix };
}

const clearDisplayState = () => {
  container.classList.remove('fade-container')
  container.classList.remove('active')
  container.classList.remove('recording')
  container.classList.remove('loading')
  container.classList.remove('fixed-mode')
  flashElement.classList.remove('flashing')

  clearTimeout(activeTimeout)
  isDown = false
  status = 'waiting'
}

const clearState = () => {
  clearDisplayState()
  isWaitingOnFinal = false
}

const previewOpened = () => {
  // Wait for preview to be shown before clearing the loading state
  clearDisplayState()
  container.classList.add('fade-container')
}

const previewClosed = () => {
  // If we're waiting on finalization of the media recording when the preview closes, we can't start
  // a new recording yet, so the record button must remain in a loading state.
  if (isWaitingOnFinal) {
    container.classList.add('loading')
    container.classList.remove('fade-container')
    status = 'finalize-blocked'
  } else {
    clearState()
  }
}

const takeScreenshot = () => {
  const currentConfig = getConfig()
  const { scene } = getSceneInfo()

  status = 'flash'
  flashElement.classList.add('flashing')
  window.XR8.CanvasScreenshot.takeScreenshot({
    onProcessFrame: ({ ctx }) => {
      if (currentConfig.onProcessFrame) {
        currentConfig.onProcessFrame({ ctx })
      }
      drawWatermark(ctx)
    },
  }).then(
    (data) => {
      const bytes = atob(data)
      const buffer = new ArrayBuffer(bytes.length)
      const array = new Uint8Array(buffer)

      for (let i = 0; i < bytes.length; i++) {
        array[i] = bytes.charCodeAt(i)
      }

      const blob = new Blob([buffer], { type: 'image/jpeg' })

      // Push analytics event for photo completion (standard mode) with different categories for sender/receiver
      if (window.dataLayer && captureMode === 'standard') {
        const category = scene === 'receiver' ? 'RE_GreetingsPhoto/videoCapture' : 'SF2_Photo/VideoTaken';
        window.dataLayer.push({
          'event': 'UltraTwo',
          'category': category,
        });
      }

      clearState()
      window.dispatchEvent(new CustomEvent('mediarecorder-photocomplete', { detail: { blob } }))
    }
  ).catch(() => {
    clearState()
  })
}

const showLoading = () => {
  if (status !== 'recording') {
    return
  }
  container.classList.remove('fixed-mode')
  container.classList.remove('recording')
  container.classList.add('loading')
  status = 'loading'
}

const endRecording = () => {
  if (status !== 'recording') {
    return
  }
  XR8.MediaRecorder.stopRecording()
  showLoading()
}

const startRecording = () => {
  if (status !== 'active') {
    return
  }

  const currentConfig = getConfig()
  status = 'recording'
  container.classList.add('recording')

  XR8.MediaRecorder.recordVideo({
    onVideoReady: (result) => {
      const { scene } = getSceneInfo()

      isWaitingOnFinal = false
      if (status === 'finalize-blocked') {
        clearState()
      }

      // Push analytics event for video completion with different categories for sender/receiver
      if (window.dataLayer) {
        const category = scene === 'receiver' ? 'RE_GreetingsPhoto/videoCapture' : 'SF2_Photo/VideoTaken';
        window.dataLayer.push({
          'event': 'UltraTwo',
          'category': category,
        });
      }

      window.dispatchEvent(new CustomEvent('mediarecorder-recordcomplete', { detail: result }))
    },
    onStart: (result) => {
      window.dispatchEvent(new CustomEvent('mediarecorder-recordstart', { detail: result }))
    },
    onStop: (result) => {
      window.dispatchEvent(new CustomEvent('mediarecorder-recordstop', { detail: result }))
      showLoading()
    },
    onError: (result) => {
      window.dispatchEvent(new CustomEvent('mediarecorder-recorderror', { detail: result }))
      clearState()
    },
    onProcessFrame: (frameInfo) => {
      const { elapsedTimeMs, maxRecordingMs, ctx } = frameInfo
      const timeLeft = (1 - elapsedTimeMs / maxRecordingMs)
      progressBar.style.strokeDashoffset = `${100 * timeLeft}`
      if (currentConfig.onProcessFrame) {
        currentConfig.onProcessFrame(frameInfo)
      }
      drawWatermark(ctx)
    },
    onPreviewReady: (result) => {
      isWaitingOnFinal = true
      window.dispatchEvent(new CustomEvent('mediarecorder-previewready', { detail: result }))
    },
    onFinalizeProgress: result => window.dispatchEvent(
      new CustomEvent('mediarecorder-finalizeprogress', { detail: result })
    ),
  })
}

const goActive = () => {
  if (status !== 'waiting') {
    return
  }

  status = 'active'

  container.classList.add('active')

  activeTimeout = setTimeout(startRecording, ACTIVE_TIMEOUT)
}

const cancelActive = () => {
  if (status !== 'active') {
    return
  }

  clearTimeout(activeTimeout)
  takeScreenshot()
}

const down = (e) => {
  e.preventDefault()
  if (isDown) {
    return
  }
  isDown = true

  // Get scene information
  const { scene } = getSceneInfo();

  if (captureMode === 'fixed') {
    if (status === 'waiting') {
      status = 'active'
      container.classList.add('fixed-mode')
      container.classList.add('active')
      startRecording()
    } else if (status === 'recording') {
      endRecording()
    }

    // Push analytics event based on scene type with different categories for sender/receiver
    if (window.dataLayer) {
      const category = scene === 'receiver' ? 'RE_GreetingsPhoto/videoCapture' : 'SF2_Photo/VideoTaken';
      window.dataLayer.push({
        'event': 'UltraTwo',
        'category': category,
      });
    }
  } else if (captureMode === 'photo') {
    container.classList.add('active')
    takeScreenshot()

    // Push analytics event for photo capture with different categories for sender/receiver
    if (window.dataLayer) {
      const category = scene === 'receiver' ? 'RE_GreetingsPhoto/videoCapture' : 'SF2_Photo/VideoTaken';
      window.dataLayer.push({
        'event': 'UltraTwo',
        'category': category,
      });
    }
  } else if (status === 'waiting') {
    // Standard mode down starts active state
    goActive()
  }
}

const up = () => {
  if (!isDown) {
    return
  }
  isDown = false
  if (captureMode !== 'standard') {
    return
  }

  if (status === 'active') {
    cancelActive()
  }

  if (status === 'recording') {
    endRecording()
  }
}

const initRecordButton = () => {
  window.XR8.addCameraPipelineModule(XR8.MediaRecorder.pipelineModule())

  document.body.insertAdjacentHTML('beforeend', htmlContent)

  container = document.querySelector('#recorder')
  flashElement = document.querySelector('#flashElement')
  progressBar = document.querySelector('#progressBar')

  const button = document.querySelector('#recorder-button')

  button.addEventListener('touchstart', down)
  button.addEventListener('mousedown', down)

  window.addEventListener('mouseup', up)
  window.addEventListener('touchend', up)

  window.addEventListener('mediarecorder-previewclosed', previewClosed)
  window.addEventListener('mediarecorder-previewopened', previewOpened)

  // Initialize with default configuration
  configure()
}

const removeRecordButton = () => {
  window.XR8.removeCameraPipelineModule(window.XR8.MediaRecorder.pipelineModule().name)
  container.parentNode.removeChild(container)
  flashElement.parentNode.removeChild(flashElement)

  window.removeEventListener('mouseup', up)
  window.removeEventListener('touchend', up)

  window.removeEventListener('mediarecorder-previewclosed', previewClosed)
  window.removeEventListener('mediarecorder-previewopened', previewOpened)
  clearState()
  container = null
  flashElement = null
  progressBar = null
}

const setCaptureMode = (mode) => {
  switch (mode) {
    case 'photo':
    case 'fixed':
      captureMode = mode
      break
    default:
      captureMode = 'standard'
  }
}

export {
  initRecordButton,
  removeRecordButton,
  setCaptureMode,
}
