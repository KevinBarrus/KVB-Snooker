// PCOL L13223
export const carpetPixel = `#if defined(CHAOTIC) || !defined(NORMAL)
#extension GL_OES_standard_derivatives : enable
#endif
#include<pcolCarpetFragmentDeclaration>
uniform vec4 vEyePosition;
varying vec3 vPositionW;
#ifdef NORMAL
varying vec3 vNormalW;
#endif
#ifdef VERTEXCOLOR
varying vec4 vColor;
#endif
#ifdef MAINUV1
varying vec2 vMainUV1;
#endif
#ifdef MAINUV2
varying vec2 vMainUV2;
#endif
#include<helperFunctions>
#include<pbrFunctions>
#include<lightFragmentDeclaration>[0..1]
#include<pbrLightFunctions>
#include<shadowsFragmentFunctions>
#ifdef CHAOTIC
#if CHAOTICDIRECTUV == 1
#define vChaoticUV vMainUV1
#elif CHAOTICDIRECTUV == 2
#define vChaoticUV vMainUV2
#else
varying vec2 vChaoticUV;
#endif
uniform sampler2D chaoticSampler;
#endif
#ifdef DIFFUSEBASE
#if DIFFUSEBASEDIRECTUV == 1
#define vDiffuseBaseUV vMainUV1
#elif DIFFUSEBASEDIRECTUV == 2
#define vDiffuseBaseUV vMainUV2
#else
varying vec2 vDiffuseBaseUV;
#endif
uniform sampler2D diffuseBaseSampler;
#endif
#ifdef DIFFUSEOVERLAY
#if DIFFUSEOVERLAYDIRECTUV == 1
#define vDiffuseOverlayUV vMainUV1
#elif DIFFUSEOVERLAYDIRECTUV == 2
#define vDiffuseOverlayUV vMainUV2
#else
varying vec2 vDiffuseOverlayUV;
#endif
uniform sampler2D diffuseOverlaySampler;
#endif
#ifdef LIGHTMAP
#if LIGHTMAPDIRECTUV == 1
#define vLightmapUV vMainUV1
#elif LIGHTMAPDIRECTUV == 2
#define vLightmapUV vMainUV2
#else
varying vec2 vLightmapUV;
#endif
uniform sampler2D lightmapSampler;
#endif
#include<clipPlaneFragmentDeclaration>
const vec3 axisY=vec3(0.0,1.0,0.0);
const vec3 white=vec3(1.0,1.0,1.0);
mat3 cotangent_frame(vec3 normal,vec3 p,vec2 uv){
uv=gl_FrontFacing ? uv : -uv;
vec3 dp1=dFdx(p);
vec3 dp2=dFdy(p);
vec2 duv1=dFdx(uv);
vec2 duv2=dFdy(uv);
vec3 dp2perp=cross(dp2,normal);
vec3 dp1perp=cross(normal,dp1);
vec3 tangent=dp2perp*duv1.x+dp1perp*duv2.x;
vec3 bitangent=dp2perp*duv1.y+dp1perp*duv2.y;
float invmax=inversesqrt(max(dot(tangent,tangent),dot(bitangent,bitangent)));
return mat3(tangent*invmax,bitangent*invmax,normal);
}
vec3 toneMappingACES( vec3 color) {
const float A=2.51;
const float B=0.03;
const float C=2.43;
const float D=0.59;
const float E=0.14;
return (color*(A*color+B))/(color*(C*color+D)+E);
}
void main(void) {
#include<clipPlaneFragment>
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
vec3 surfaceAlbedo=vDiffuseColor.rgb;
float alpha=vDiffuseColor.a;
#ifdef DIFFUSEOVERLAY
vec4 overlayTexture=texture2D(diffuseOverlaySampler,vDiffuseOverlayUV);
float overlayMixFactor=overlayTexture.a*vDiffuseOverlayInfos.y;
surfaceAlbedo=mix( surfaceAlbedo,toLinearSpace(overlayTexture.rgb),overlayMixFactor );
#endif
#ifdef VERTEXCOLOR
surfaceAlbedo*=vColor.rgb;
#endif
#ifdef VERTEXALPHA
alpha*=vColor.a;
#endif
#ifdef ALPHATEST
if (alpha<=0.4)discard;
#endif
#ifdef NORMAL
#ifdef CHAOTIC
mat3 transform=cotangent_frame(vNormalW,vPositionW,vChaoticUV );
vec3 normalOffset=texture2D(chaoticSampler,vChaoticUV).rgb*2.0-1.0;
const vec3 normalOffset0=vec3(0.0,0.0,1.0);
normalOffset=mix(normalOffset0,normalOffset,vChaoticInfos.y);
vec3 normalW=normalize( transform*normalOffset )*-vEyePosition.w;
#else
vec3 normalW=normalize(vNormalW)*-vEyePosition.w;
#endif
#else
#ifdef CHAOTIC
vec3 normalW=normalize(cross(dFdx(vPositionW),dFdy(vPositionW));
mat3 transform=cotangent_frame(normalW,vPositionW,vChaoticUV );
vec3 normalOffset=texture2D(chaoticSampler,vChaoticUV).rgb*2.0-1.0;
normalW=normalize( transform*normalOffset )*-vEyePosition.w;
#else
vec3 normalW=normalize(cross(dFdx(vPositionW),dFdy(vPositionW)))*-vEyePosition.w;
#endif
#endif
float NdotVUnclamped=dot( normalW,viewDirectionW );
float NdotV=clamp(NdotVUnclamped,0.,1.)+0.00001;
float reflectance=max(max(vReflectivityColor.r,vReflectivityColor.g),vReflectivityColor.b);
vec3 specularEnvironmentR0=vReflectivityColor;
vec3 specularEnvironmentR90=vec3(1.0);
vec3 diffuseBase=vec3(0.,0.,0.);
#ifdef SPECULARTERM
vec3 specularBase=vec3(0.,0.,0.);
#endif
lightingInfo info;
float shadow=1.;
float roughness=1.0;
float NdotL=-1.;
float geometricRoughnessFactor=0.;
#include<pcolLightFragment>[0..1]
#ifdef DIFFUSEBASE
vec3 diffuseBaseTexture=toLinearSpace(texture2D(diffuseBaseSampler,vDiffuseBaseUV).rgb);
diffuseBase*=mix( white,diffuseBaseTexture,vDiffuseBaseInfos.y);
#ifdef SPECULARTERM
specularBase*=diffuseBaseTexture*2.0;
#endif
#endif
#ifdef LIGHTMAP
vec3 lightmapColor=texture2D(lightmapSampler,vLightmapUV).rgb;
diffuseBase+=lightmapColor.b;
diffuseBase*=lightmapColor.g;
#ifdef SPECULARTERM
reflectance*=(1.0-lightmapColor.r);
specularBase*=lightmapColor.g*(1.0-lightmapColor.r);
#endif
#endif
vec3 finalDiffuse=max(diffuseBase*surfaceAlbedo*(1.0-reflectance),0.0);
vec3 final=finalDiffuse;
#ifdef SPECULARTERM
final+=specularBase;
#endif
#if TONEMAPPINGMODE == 3
final=toneMappingACES( final );
#elif TONEMAPPINGMODE == 2
const float tonemappingCalibration=1.590579;
final=1.0-exp2(-tonemappingCalibration*final);
#elif TONEMAPPINGMODE == 1
final=final/(final+vec3(1.0));
#endif
final=toGammaSpace( final );
gl_FragColor=vec4( final,alpha );
}
`;
