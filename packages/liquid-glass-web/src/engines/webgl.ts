function submitProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const shaders: WebGLShader[] = [];
  const make = (type: number, src: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to allocate WebGL2 shader");
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "shader compile error";
      gl.deleteShader(shader);
      throw new Error(log);
    }
    shaders.push(shader);
    return shader;
  };
  const p = gl.createProgram();
  if (!p) throw new Error("Failed to allocate WebGL2 program");
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  return { p, shaders };
}

function checkedProgram(gl: WebGL2RenderingContext, p: WebGLProgram, shaders: WebGLShader[]) {
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const failed = shaders.find((shader) => !gl.getShaderParameter(shader, gl.COMPILE_STATUS));
    const msg = (failed ? gl.getShaderInfoLog(failed) : gl.getProgramInfoLog(p)) ?? "link error";
    for (const s of shaders) gl.deleteShader(s);
    gl.deleteProgram(p);
    throw new Error(msg);
  }
  for (const s of shaders) gl.deleteShader(s);
  const locations = new Map<string, WebGLUniformLocation | null>();
  return {
    p,
    u(name: string) {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(p, name));
      return locations.get(name) ?? null;
    },
  };
}

export type WebGLProgramHandle = ReturnType<typeof checkedProgram>;

export function createProgram(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
): WebGLProgramHandle {
  const { p, shaders } = submitProgram(gl, vs, fs);
  return checkedProgram(gl, p, shaders);
}

export function createTexture(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  opts: { internal: number; format: number; type: number; filter: number },
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Failed to allocate WebGL2 texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, opts.internal, w, h, 0, opts.format, opts.type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}
