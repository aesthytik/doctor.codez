// The marks that make up the lights: soft glows and beams that fade as they rise.
// Both are small variations on stock deck.gl layers.
import { ColumnLayer, ScatterplotLayer } from "@deck.gl/layers";

/**
 * Additive blending: overlapping lights get brighter instead of covering each
 * other, so a stadium with hundreds of goals burns white-hot at its centre.
 */
export const ADDITIVE = {
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one",
  blendAlphaSrcFactor: "one",
  blendAlphaDstFactor: "one-minus-src-alpha",
  blendColorOperation: "add",
  blendAlphaOperation: "add",
  depthWriteEnabled: false,
} as const;

/** A disc whose brightness falls away smoothly from the centre. */
export class GlowLayer<DataT = unknown> extends ScatterplotLayer<DataT> {
  static layerName = "GlowLayer";

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      inject: {
        "fs:DECKGL_FILTER_COLOR": `
          float glowDist = clamp(length(geometry.uv), 0.0, 1.0);
          float glow = 1.0 - glowDist;
          color.a *= glow * glow * (3.0 - 2.0 * glow) * glow;
        `,
      },
    };
  }
}

/** A column that is brightest at the ground and fades to nothing at its tip. */
export class BeamLayer<DataT = unknown> extends ColumnLayer<DataT> {
  static layerName = "BeamLayer";

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      inject: {
        "vs:#main-end": `
          float beamT = clamp((positions.z + 1.0) / 2.0, 0.0, 1.0);
          vColor.a *= pow(1.0 - beamT, 1.7);
        `,
      },
    };
  }
}
