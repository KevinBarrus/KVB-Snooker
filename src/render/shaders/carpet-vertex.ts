// PCOL L13222
export const carpetVertex = `#include<pcolCarpetVertexDeclaration>
attribute vec3 position;
#ifdef NORMAL
attribute vec3 normal;
#endif
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#ifdef VERTEXCOLOR
attribute vec4 color;
#endif
#include<instancesDeclaration>
#ifdef MAINUV1
varying vec2 vMainUV1;
#endif
#ifdef MAINUV2
varying vec2 vMainUV2;
#endif
#if defined(CHAOTIC) && CHAOTICDIRECTUV == 0
varying vec2 vChaoticUV;
#endif
#if defined(DIFFUSEBASE) && DIFFUSEBASEDIRECTUV == 0
varying vec2 vDiffuseBaseUV;
#endif
#if defined(DIFFUSEOVERLAY) && DIFFUSEOVERLAYDIRECTUV == 0
varying vec2 vDiffuseOverlayUV;
#endif
#if defined(LIGHTMAP) && LIGHTMAPDIRECTUV == 0
varying vec2 vLightmapUV;
#endif
varying vec3 vPositionW;
#ifdef NORMAL
varying vec3 vNormalW;
#endif
#ifdef VERTEXCOLOR
varying vec4 vColor;
#endif
#include<clipPlaneVertexDeclaration>
#include<lightFragmentDeclaration>[0..1]
void main(void) {
#include<instancesVertex>
gl_Position=viewProjection*finalWorld*vec4(position,1.0);
vec4 worldPos=finalWorld*vec4(position,1.0);
vPositionW=vec3(worldPos);
#ifdef NORMAL
vNormalW=normalize(vec3(finalWorld*vec4(normal,0.0)));
#endif
#ifndef UV1
vec2 uv=vec2(0.,0.);
#endif
#ifndef UV2
vec2 uv2=vec2(0.,0.);
#endif
#ifdef MAINUV1
vMainUV1=uv;
#endif
#ifdef MAINUV2
vMainUV2=uv2;
#endif
#if defined(CHAOTIC) && CHAOTICDIRECTUV == 0
if (vChaoticInfos.x == 0.){
vChaoticUV=vec2(chaoticMatrix*vec4(uv,1.0,0.0));
}else{
vChaoticUV=vec2(chaoticMatrix*vec4(uv2,1.0,0.0));
}
#endif
#if defined(DIFFUSEBASE) && DIFFUSEBASEDIRECTUV == 0
if (vDiffuseBaseInfos.x == 0.){
vDiffuseBaseUV=vec2(diffuseBaseMatrix*vec4(uv,1.0,0.0));
}else{
vDiffuseBaseUV=vec2(diffuseBaseMatrix*vec4(uv2,1.0,0.0));
}
#endif
#if defined(DIFFUSEOVERLAY) && DIFFUSEOVERLAYDIRECTUV == 0
if (vDiffuseOverlayInfos.x == 0.){
vDiffuseOverlayUV=vec2(diffuseOverlayMatrix*vec4(uv,1.0,0.0));
}else{
vDiffuseOverlayUV=vec2(diffuseOverlayMatrix*vec4(uv2,1.0,0.0));
}
#endif
#if defined(LIGHTMAP) && LIGHTMAPDIRECTUV == 0
if (vLightmapInfos.x == 0.){
vLightmapUV=vec2( lightmapMatrix*vec4(uv,1.0,0.0) );
}else{
vLightmapUV=vec2( lightmapMatrix*vec4(uv2,1.0,0.0) );
}
#endif
#include<clipPlaneVertex>
#include<shadowsVertex>[0..1]
#ifdef VERTEXCOLOR
vColor=color;
#endif
#include<pointCloudVertex>
}
`;
