import { FRAG_SHADER, VERT_SHADER } from "./shaders.js";

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  return shader;
}

// Two-pass renderer: all game entities are drawn to an offscreen 2D canvas,
// then the result is uploaded as a texture and composited through a WebGL
// fragment shader that adds bloom, scanlines, and vignette.
export class GameRenderer {
  private offscreen: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private glCanvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private gridPattern: CanvasPattern | null = null;
  private w = 0;
  private h = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.glCanvas = canvas;
    this.offscreen = document.createElement("canvas");
    this.ctx = this.offscreen.getContext("2d")!;

    // WebGL pipeline for post-processing
    this.gl = canvas.getContext("webgl2", { premultipliedAlpha: false })!;
    const gl = this.gl;

    const vert = createShader(gl, gl.VERTEX_SHADER, VERT_SHADER)!;
    const frag = createShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER)!;

    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vert);
    gl.attachShader(this.program, frag);
    gl.linkProgram(this.program);
    gl.useProgram(this.program);

    // Fullscreen quad -- two triangles covering clip space [-1,1]
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const posLoc = gl.getAttribLocation(this.program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Texture target for the offscreen canvas content
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const resize = () => {
      this.glCanvas.width = window.innerWidth;
      this.glCanvas.height = window.innerHeight;
      this.offscreen.width = window.innerWidth;
      this.offscreen.height = window.innerHeight;
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.gridPattern = this.createGridPattern();
      gl.viewport(0, 0, this.w, this.h);
    };
    resize();

    window.addEventListener("resize", resize);
  }

  // Semi-transparent fill instead of full clear produces a motion trail effect
  beginFrame(): void {
    const { ctx, w, h } = this;

    ctx.fillStyle = "rgba(2, 4, 12, 0.25)";
    ctx.fillRect(0, 0, w, h);

    if (this.gridPattern) {
      ctx.fillStyle = this.gridPattern;
      ctx.fillRect(0, 0, w, h);
    }

    // Center origin, flip Y so +Y is up (math convention)
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, -1);
  }

  // Diamond outline with inner crosshair
  drawEnemy(x: number, y: number, rotation: number, hue: number, scale: number): void {
    const { ctx } = this;
    const color = `hsl(${345 + hue}, 100%, 50%)`;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-rotation);
    ctx.scale(scale, scale);

    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(8, 0);
    ctx.lineTo(0, -10);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(4, 0);
    ctx.moveTo(0, -4);
    ctx.lineTo(0, 4);
    ctx.stroke();

    ctx.restore();
  }

  // Short line segment in the bullet's travel direction
  drawBullet(x: number, y: number, dx: number, dy: number): void {
    const { ctx } = this;
    ctx.strokeStyle = "#00ffff";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - dx * 12, y - dy * 12);
    ctx.stroke();
  }

  // Two concentric hexagonal rings that expand and fade out
  drawExplosion(x: number, y: number, progress: number, rotationOffset: number, maxRadius: number): void {
    const { ctx } = this;
    const alpha = 1 - progress;
    const radius = maxRadius * progress;

    ctx.strokeStyle = "#ff0055";
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;

    // Outer hexagon
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + rotationOffset;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    // Inner hexagon rotated 30 degrees
    const innerRadius = radius * 0.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6 + rotationOffset;
      const px = x + Math.cos(angle) * innerRadius;
      const py = y + Math.sin(angle) * innerRadius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  // Arrow-shaped ship: triangle with center notch, thruster flame when moving
  drawPlayer(x: number, y: number, rotation: number, speed: number): void {
    const { ctx } = this;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-rotation);

    // Thruster flame visible above minimum speed
    if (speed > 10) {
      ctx.strokeStyle = "#00ffff";
      ctx.lineWidth = 2;
      const thrustLen = Math.min(speed * 0.08, 6);
      ctx.beginPath();
      ctx.moveTo(-3, -10);
      ctx.lineTo(0, -10 - thrustLen);
      ctx.lineTo(3, -10);
      ctx.stroke();
    }

    ctx.strokeStyle = "#00ffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(-10, -10);
    ctx.lineTo(0, -6);
    ctx.lineTo(10, -10);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = "#00ffff";
    ctx.fillRect(-2, 0, 4, 4);

    ctx.restore();
  }

  // Hexagonal shield outline
  drawShield(x: number, y: number, radius: number): void {
    const { ctx } = this;
    ctx.strokeStyle = "#00ffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Upload the 2D canvas as a texture and run the post-processing shader
  endFrame(): void {
    const { ctx, gl, offscreen, w, h } = this;
    ctx.restore();

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);

    const resLoc = gl.getUniformLocation(this.program, "u_resolution");
    gl.uniform2f(resLoc, w, h);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Tile a small L-shaped stroke to create a subtle grid overlay
  private createGridPattern(): CanvasPattern | null {
    const patternCanvas = document.createElement("canvas");
    const size = 40;
    patternCanvas.width = size;
    patternCanvas.height = size;
    const pctx = patternCanvas.getContext("2d");
    if (!pctx) return null;

    pctx.strokeStyle = "rgba(0, 255, 255, 0.03)";
    pctx.lineWidth = 1;
    pctx.beginPath();
    pctx.moveTo(0, size);
    pctx.lineTo(0, 0);
    pctx.lineTo(size, 0);
    pctx.stroke();

    return this.ctx.createPattern(patternCanvas, "repeat");
  }
}
