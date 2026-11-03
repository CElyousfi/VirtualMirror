/**
 * Shopper-facing copy. Claims policy: we say "see how they look", never
 * "see how they fit". Nothing here references prescription, dispensing or fit.
 */
export const MSG = {
  title: "Virtual Mirror",
  starting: "Starting your camera…",
  loadingTracker: "Getting the mirror ready…",
  loadingFrame: "Loading the frame…",
  lookAtCamera: "Look at the camera",
  moveCloser: "Move a little closer",
  tooClose: "Move back a little",
  trackingLost: "Looking for your face…",
  slowDevice: "This device may be too slow for a smooth preview.",
  disclaimer: "Shows how the frames look. Size is approximate and fit is not measured.",
  hide: "Hide glasses",
  show: "Show glasses",
  addToCart: "Add to cart",
  adding: "Adding…",
  added: "Added to cart",
  viewCart: "View cart",
  close: "Close",
  variantUnavailable: "This colour isn't available in the mirror yet.",
  errors: {
    denied: "Camera access was blocked. Allow camera access in your browser settings to use the mirror.",
    noCamera: "No camera was found on this device.",
    insecure: "The mirror needs a secure (https) page to use the camera.",
    unsupported: "This browser can't run the mirror. Try a recent version of Safari or Chrome.",
    unavailable: "The 3D frame for this product isn't available right now.",
    frameFailed: "The 3D frame could not be loaded.",
    trackerFailed: "The mirror could not start on this device.",
    cartFailed: "Could not add to cart. Please use the button on the product page.",
  },
} as const;
