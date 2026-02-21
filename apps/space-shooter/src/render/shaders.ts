// Passthrough vertex shader. Maps clip-space quad positions to UV coordinates
// for full-screen texture sampling. Flips Y so the 2D canvas origin (top-left)
// maps correctly to WebGL texture space.
export const VERT_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Post-processing fragment shader. Applies three effects in sequence:
// 1. Bloom: 5-tap box blur blended with the sharp image for a glow effect
// 2. Scanlines: horizontal sine wave darkening for a CRT look
// 3. Vignette: darken edges using a parabolic falloff
export const FRAG_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_resolution;

void main() {
  vec2 texel = 1.0 / u_resolution;
  vec4 col = texture(u_tex, v_uv);

  // Simple box blur for glow (5-tap)
  vec4 blur = col * 0.4;
  blur += texture(u_tex, v_uv + vec2(texel.x * 2.0, 0.0)) * 0.15;
  blur += texture(u_tex, v_uv - vec2(texel.x * 2.0, 0.0)) * 0.15;
  blur += texture(u_tex, v_uv + vec2(0.0, texel.y * 2.0)) * 0.15;
  blur += texture(u_tex, v_uv - vec2(0.0, texel.y * 2.0)) * 0.15;

  // Combine sharp + bloom
  vec4 result = col + blur * 0.6;

  // Scanline effect
  float scanline = sin(v_uv.y * u_resolution.y * 1.5) * 0.03 + 0.97;
  result.rgb *= scanline;

  // Vignette
  vec2 vig = v_uv * (1.0 - v_uv);
  float vigFactor = pow(vig.x * vig.y * 15.0, 0.25);
  result.rgb *= vigFactor;

  fragColor = result;
}`;
