import { DotLottieReact, setWasmUrl } from "@lottiefiles/dotlottie-react";
import lottieWasmUrl from "@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm?url";

// Load the local player only when an animated icon is rendered. Product loaders
// are SVGs and must never pull this runtime into the application entry bundle.
setWasmUrl(lottieWasmUrl);

export default DotLottieReact;
