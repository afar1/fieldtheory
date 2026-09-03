# Third-party notices

The executable source, dependency code, and model weights do not all use the same license.

## FluidAudio 0.15.6

- Component: FluidInference/FluidAudio Swift package
- Source: https://github.com/FluidInference/FluidAudio/tree/v0.15.6
- License: Apache License 2.0
- Copyright: FluidAudio contributors
- License text: https://github.com/FluidInference/FluidAudio/blob/v0.15.6/LICENSE

Field Theory calls FluidAudio as an unmodified Swift package dependency. Apache-2.0 permits commercial distribution, but a distributed copy must retain the license, copyright, attribution, and NOTICE material that applies to the dependency.

## Speaker diarization model weights

- Component: FluidInference/speaker-diarization-coreml
- Source: https://huggingface.co/FluidInference/speaker-diarization-coreml
- Parent model: https://huggingface.co/pyannote/speaker-diarization-community-1
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- License text: https://creativecommons.org/licenses/by/4.0/legalcode
- Attribution: pyannote.audio and Fluid Inference contributors
- Modification notice: Fluid Inference converted the Community-1 pipeline models to Core ML. This Field Theory sidecar downloads or loads those published Core ML artifacts and does not modify their weights.

CC BY 4.0 permits commercial use and redistribution. Distribution must give appropriate credit, link to the license, indicate whether changes were made, and must not add restrictions that prevent recipients from exercising the license rights.

The weights are not MIT-licensed. Shipping this sidecar with the weights is therefore not an MIT-only distribution. Core ML is an Apple platform framework and is not an open-source dependency.
