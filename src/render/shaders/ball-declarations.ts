// PCOL L10175
export const pcolDyIBLFragmentDeclaration = `uniform vec4 vDiffuseColor;
#ifdef DIFFUSE
uniform vec2 vDiffuseInfos;
#endif
#ifdef AO
uniform vec2 vAoInfos;
#endif
#ifdef REFLECTIVITYROUGHNESS
uniform vec2 vReflectivityRoughnessInfos;
#endif
#ifdef USELODFALLOFF
uniform vec4 vLodFallOff;
#endif
uniform vec4 vLightProbeInfos;
uniform vec4 vReflectivity;
#ifdef USEPARALLAXCORRECTION
uniform mat3 vAABB;
#endif
#ifdef POINTSIZE
uniform float pointSize;
#endif
`;

// PCOL L10177
export const pcolDyIBLVertexDeclaration = `
uniform mat4 viewProjection;
uniform mat4 view;
#ifdef DIFFUSE
uniform mat4 diffuseMatrix;
uniform vec2 vDiffuseInfos;
#endif
#ifdef AO
uniform mat4 aoMatrix;
uniform vec2 vAoInfos;
#endif
#ifdef REFLECTIVITYROUGHNESS
uniform mat4 reflectivityRoughnessMatrix;
uniform vec2 vReflectivityRoughnessInfos;
#endif
#ifdef USELODFALLOFF
uniform vec4 vLodFallOff;
#endif
#ifdef POINTSIZE
uniform float pointSize;
#endif`;
