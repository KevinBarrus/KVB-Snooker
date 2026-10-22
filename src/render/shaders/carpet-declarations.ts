// PCOL L13224
export const pcolCarpetFragmentDeclaration = `uniform vec4 vDiffuseColor;
uniform vec3 vReflectivityColor;
#ifdef CHAOTIC
uniform vec2 vChaoticInfos;
#endif
#ifdef DIFFUSEBASE
uniform vec2 vDiffuseBaseInfos;
#endif
#ifdef DIFFUSEOVERLAY
uniform vec2 vDiffuseOverlayInfos;
#endif
#ifdef LIGHTMAP
uniform vec2 vLightmapInfos;
#endif`;

// PCOL L13226
export const pcolCarpetVertexDeclaration = `
uniform mat4 viewProjection;
uniform mat4 view;
#ifdef CHAOTIC
uniform mat4 chaoticMatrix;
uniform vec2 vChaoticInfos;
#endif
#ifdef DIFFUSEBASE
uniform mat4 diffuseBaseMatrix;
uniform vec2 vDiffuseBaseInfos;
#endif
#ifdef DIFFUSEOVERLAY
uniform mat4 diffuseOverlayMatrix;
uniform vec2 vDiffuseOverlayInfos;
#endif
#ifdef LIGHTMAP
uniform mat4 lightmapMatrix;
uniform vec2 vLightmapInfos;
#endif
#ifdef POINTSIZE
uniform float pointSize;
#endif`;
