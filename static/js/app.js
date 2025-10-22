import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

let scene, camera, renderer, controls;
let currentModel = null;
let mixer = null;
let clock = new THREE.Clock();
let characterMeshes = {};
let bonesBooleans = {};
let skinMeshes = [];
let tshirtMeshes = [];
let hairMeshes = [];
let fbxModel = null;

//expose functions to global window -> can be called by html
window.init = init;
window.loadCharacter = loadCharacter;
window.generateExercise = generateExercise;
window.checkFileInfo = checkFileInfo;


function init() {
    const container = document.getElementById('viewer-container');
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 3);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    new RGBELoader().load(
        '/env/studio_hdr.hdr',
        (texture) => {
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            scene.environment = envMap;
            // scene.background = envMap;
            scene.background = new THREE.Color(0xeeeeee);
            texture.dispose();
            pmremGenerator.dispose();
        },
        undefined,
        (error) => {
            console.error('Error loading HDRI:', error);
            scene.background = new THREE.Color(0xcccccc);
        }
    );

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 3;
    controls.maxDistance = 3;
    controls.minAzimuthAngle = 5;
    controls.maxAzimuthAngle = -5;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI/2;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.bias = -0.0001;
    scene.add(directionalLight);

    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0xeeeeee,
        roughness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    loadCharacter('female');
    window.addEventListener('resize', onWindowResize);
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    if (controls) controls.update();
    renderer.render(scene, camera);
}

function findSkinMeshes(root) {
    const candidates = [];
    root.traverse((child) => {
        if (!child.isMesh) return;
        const name = (child.name || "").toLowerCase();
        const matName = (child.material && child.material.name || "").toLowerCase();
        
        //exclude clothing items
        const isClothing = (
            name.includes("shirt") || name.includes("tshirt") || name.includes("top") ||
            name.includes("sweater") || name.includes("jacket") ||
            name.includes("pant") || name.includes("trouser") || name.includes("bottom") ||
            name.includes("shoe") || name.includes("boot") || name.includes("sock") ||
            name.includes("collar") || name.includes("sleeve") || name.includes("dress") ||
            matName.includes("shirt") || matName.includes("pant") || 
            matName.includes("shoe") || matName.includes("collar") ||
            matName.includes("sweater")
        );
        
        // Match skin & body
        const isSkin = (
            (name.includes("skin") || matName.includes("skin")) ||
            (name.includes("face") || matName.includes("face")) ||
            (name.includes("head") && !name.includes("hair")) ||
            (name.includes("hand") || matName.includes("hand")) ||
            (name.includes("arm") && !name.includes("sleeve")) ||
            (name.includes("leg") && !name.includes("pant")) ||
            (name.includes("body") && !isClothing) || 
            (name.match(/^ch\d+_body/i))
        );
        
        if (isSkin && !isClothing) {
            candidates.push(child);
        }
    });
    return candidates;
}

function findTshirtMeshes(root) {
    if (!root || typeof root.traverse !== 'function') return [];
    const candidates = [];
    root.traverse((child) => {
        if (!child.isMesh) return;
        const name = (child.name || "").toLowerCase();
        const matName = (child.material && child.material.name || "").toLowerCase();
        if (
            name.includes("tops") ||
            name.includes("sweater") ||
            name.includes("top") ||
            name.includes("tshirt") ||
            name.includes("shirt") ||
            matName.includes("tshirt") ||
            matName.includes("shirt")
        ) {
            candidates.push(child);
            tshirtMeshes.push(child);
        }
    });
    return candidates;
}

function findHairMeshes(root) {
    if (!root || typeof root.traverse !== 'function') return [];
    const candidates = [];
    root.traverse((child) => {
        if (!child.isMesh) return;
        const name = (child.name || "").toLowerCase();
        const matName = (child.material && child.material.name || "").toLowerCase();
        if (
            matName.includes("Ch31_Hair001") ||
            (name.match(/^ch\d+_hair001/i))
        ) {
            candidates.push(child);
            hairMeshes.push(child);
        }
    });
    return candidates;
}

function loadCharacter(characterType) {
    if (mixer) {
        try { mixer.stopAllAction(); } catch (e) {}
        mixer = null;
    }
    if (currentModel) {
        scene.remove(currentModel);
        currentModel = null;
    }
    skinMeshes = [];
    tshirtMeshes = [];
    hairMeshes = [];
    characterMeshes = {};
    bonesBooleans = {};

    const loader = new FBXLoader();
    const modelMap = {
        'female': '/data/w_keyShapes.fbx',
        'demo': '/data/model_with_skin.fbx'
    };
    const modelUrl = modelMap[characterType] || `/data/${characterType}.fbx` || '/data/model_with_skin.fbx';

    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';

    loader.load(
        modelUrl,
        (fbx) => {
            fbxModel = fbx;
            currentModel = fbx;

            const baseScale = 0.01;
            fbx.scale.setScalar(baseScale);

            const box = new THREE.Box3().setFromObject(fbx);
            const center = box.getCenter(new THREE.Vector3());
            fbx.position.sub(center);
            const bboxMin = box.min.clone().sub(center);
            fbx.position.y -= bboxMin.y;

            fbx.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = true;
                child.receiveShadow = true;

                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    
                    materials.forEach((mat, i) => {
                        const newMat = mat.clone();
                        if (newMat.map && newMat.map.image) {
                            newMat.map.colorSpace = THREE.SRGBColorSpace;
                            newMat.map.needsUpdate = true;
                        }
                        
                        if (newMat.roughness === undefined) newMat.roughness = 0.8;
                        if (newMat.metalness === undefined) newMat.metalness = 0.1;
                        
                        
                        if (newMat.type !== 'MeshStandardMaterial') {
                            const standardMat = new THREE.MeshStandardMaterial({
                                map: newMat.map,
                                color: newMat.color || 0xffffff,
                                roughness: 0.8,
                                metalness: 0.1,
                                normalMap: newMat.normalMap,
                                name: newMat.name
                            });
                            
                            if (Array.isArray(child.material)) {
                                child.material[i] = standardMat;
                            } else {
                                child.material = standardMat;
                            }
                        } else {
                            if (Array.isArray(child.material)) {
                                child.material[i] = newMat;
                            } else {
                                child.material = newMat;
                            }
                        }
                    });
                }
            });
            
            
            tshirtMeshes = findTshirtMeshes(fbx);
            hairMeshes = findHairMeshes(fbx);
            // bonesBooleans = findBones(fbx);
            skinMeshes = findSkinMeshes(fbx);

            fbx.traverse((child) => {
                if (child.isMesh && child.morphTargetDictionary) {
                    characterMeshes[child.name.toLowerCase()] = child;
                }
            });

            bonesBooleans = {};

            fbx.traverse((child) => {
                if (child.isSkinnedMesh && child.skeleton) {
                    bonesBooleans[child.name] = {}; 
                    for (const bone of child.skeleton.bones) {
                        bonesBooleans[child.name][bone.name] = bone;
                    }
                }
            });

            if (fbx.animations && fbx.animations.length) {
                mixer = new THREE.AnimationMixer(fbx);
                fbx.userData.animations = {};
                fbx.animations.forEach((clip, i) => {
                    const action = mixer.clipAction(clip);
                    fbx.userData.animations[clip.name || `anim_${i}`] = action;
                });
                console.log('Animations found:', Object.keys(fbx.userData.animations));
            }
            scene.add(fbx);

            if (overlay) overlay.style.display = 'none';
            console.log(`Loaded model '${modelUrl}' — skin meshes: ${skinMeshes.length}, tshirt meshes: ${tshirtMeshes.length}`);
            console.log('Skin meshes:', skinMeshes.map(m => m.name));
            console.log('Tshirt meshes:', tshirtMeshes.map(m => m.name));
            console.log('Hair meshes:', hairMeshes.map(m => m.name));
        },
        (xhr) => {
            if (xhr.total) {
                const pct = (xhr.loaded / xhr.total * 100).toFixed(1);
                // console.log(`Loading ${modelUrl}: ${pct}%`);
            }
        },
        (err) => {
            console.error(`Failed to load ${modelUrl}:`, err);
            if (overlay) overlay.style.display = 'none';
        }
    );
}


function getSkinColor(toneValue) {
    const lightSkin = new THREE.Color(0xfdbcb4);
    const mediumSkin = new THREE.Color(0xd08b5b);
    const darkSkin = new THREE.Color(0x8d5524);

    const factor = toneValue / 100;
    
    if (factor < 0.5) {
        return lightSkin.lerp(mediumSkin, factor * 2);
    } else {
        return mediumSkin.lerp(darkSkin, (factor - 0.5) * 2);
    }
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function selectCharacter(type) {
    document.querySelectorAll('.character-option').forEach(el => el.classList.remove('selected'));
    document.querySelector(`[data-character="${type}"]`).classList.add('selected');
    loadCharacter(type);
}


//hair selection -------

const defaultHair = document.getElementById('defaultHair');
const customHair = document.getElementById('customHair');
if (defaultHair) defaultHair.addEventListener('click', showDefaultHair);
if (customHair)  customHair.addEventListener('click', showCustomHair);

function setHairVisibility(index, visible) {
    if (!Array.isArray(hairMeshes) || !hairMeshes.length) {
        console.warn('No hair meshes available');
        return;
    }
    if (index < 0 || index >= hairMeshes.length) {
        console.warn('Tshirt index out of range', index);
        return;
    }
    hairMeshes[index].visible = !!visible;
    renderer.render(scene, camera);
}

function showDefaultHair() { 
    if (hairMeshes.length >= 1) { 
        setHairVisibility(0, false); 
    } 
}

function showCustomHair() { 
    if (hairMeshes.length >= 1) { 
        setHairVisibility(0, true);  
    } 
}



//shirt selection

const defaultTshirt = document.getElementById('defaultTshirt');
const customTshirt = document.getElementById('customTshirt');
if (defaultTshirt) defaultTshirt.addEventListener('click', showDefaultTshirt);
if (customTshirt)  customTshirt.addEventListener('click', showCustomTshirt);

function setTshirtVisibility(index, visible) {
    if (!Array.isArray(tshirtMeshes) || !tshirtMeshes.length) {
        console.warn('No tshirt meshes available to toggle');
        return;
    }
    if (index < 0 || index >= tshirtMeshes.length) {
        console.warn('Tshirt index out of range', index);
        return;
    }
    tshirtMeshes[index].visible = !!visible;
    renderer.render(scene, camera);
}

function showDefaultTshirt() { 
    if (tshirtMeshes.length > 1) { 
        setTshirtVisibility(0, false); 
        setTshirtVisibility(1, true); 
    } 
}

function showCustomTshirt() { 
    if (tshirtMeshes.length > 1) { 
        setTshirtVisibility(0, true);  
        setTshirtVisibility(1, false); 
    } 
}

function checkFileInfo() {
    const model = (currentModel && typeof currentModel.traverse === 'function') ? currentModel
                 : (fbxModel && typeof fbxModel.traverse === 'function') ? fbxModel
                 : null;
    if (!model) {
        console.warn('fbx is null');
        return;
    }

    const getMaterialInfo = (mat) => {
        if (!mat) return null;
        const m = {};
        m.name = mat.name || 'unnamed';
        m.type = mat.type || 'Material';
        if (mat.color) m.color = `#${mat.color.getHexString()}`;
        const texProps = ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap'];
        m.textures = texProps.filter(p => mat[p]).map(p => ({ prop: p, name: mat[p].name || mat[p].source?.file || mat[p].image?.src || 'unknown' }));
        m.roughness = mat.roughness !== undefined ? mat.roughness : null;
        m.metalness = mat.metalness !== undefined ? mat.metalness : null;
        return m;
    };

    const inspectMesh = (mesh) => {
        const g = mesh.geometry;
        const info = {
            name: mesh.name || 'unnamed',
            isSkinnedMesh: !!mesh.isSkinnedMesh,
            vertexCount: g.attributes.position ? g.attributes.position.count : 0,
            hasNormals: !!g.attributes.normal,
            hasUVs: !!g.attributes.uv,
            hasColors: !!g.attributes.color,
            indexCount: g.index ? g.index.count : null,
            morphTargetCount: g.morphAttributes && Object.keys(g.morphAttributes).length ? (g.morphAttributes.position ? g.morphAttributes.position.length : 0) : 0,
            material: null,
            skeletonBoneCount: mesh.skeleton ? mesh.skeleton.bones.length : 0,
            skinIndexAttr: !!g.attributes.skinIndex,
            skinWeightAttr: !!g.attributes.skinWeight
        };

        if (Array.isArray(mesh.material)) {
            info.material = mesh.material.map(getMaterialInfo);
        } else {
            info.material = getMaterialInfo(mesh.material);
        }

        if (g.attributes.skinIndex) {
            const arr = g.attributes.skinIndex.array;
            const indices = new Set();
            for (let i = 0; i < arr.length; i++) indices.add(arr[i]);
            info.uniqueSkinIndices = indices.size;
        }

        return info;
    };

    const summary = {
        rootName: model.name || 'root',
        objectCount: 0,
        meshes: [],
        materials: {},
        skeletons: [],
        morphTargets: {},
        animations: [],
        boundingBox: null
    };

    try {
        const box = new THREE.Box3().setFromObject(model);
        summary.boundingBox = {
            min: box.min.toArray(),
            max: box.max.toArray(),
            size: box.getSize(new THREE.Vector3()).toArray()
        };
    } catch (e) {
        summary.boundingBox = 'failed to compute';
    }

    model.traverse((child) => {
        summary.objectCount++;
        if (child.isMesh) {
            const mi = inspectMesh(child);
            summary.meshes.push(mi);

            if (Array.isArray(child.material)) {
                child.material.forEach(m => {
                    if (m && !summary.materials[m.name || 'unnamed']) summary.materials[m.name || m.uuid] = getMaterialInfo(m);
                });
            } else if (child.material) {
                const m = child.material;
                if (!summary.materials[m.name || m.uuid]) summary.materials[m.name || m.uuid] = getMaterialInfo(m);
            }

            if (child.morphTargetDictionary) {
                summary.morphTargets[child.name || 'unnamed'] = Object.keys(child.morphTargetDictionary);
                console.log("Shape Keys: ", child.morphTargetDictionary);
                
            }
        }

        if (child.isSkinnedMesh && child.skeleton) {
            // bonesBooleans[child.name.toLowerCase()] = child
            summary.skeletons.push({
                skinnedMesh: child.name || 'skinnedMesh',
                boneCount: child.skeleton.bones.length,
                bones: child.skeleton.bones.map(b => b.name)
            });
        }
    });

    const anims = model.animations || (model.userData && model.userData.animations) || [];
    if (anims.length) {
        summary.animations = anims.map(a => ({ name: a.name || 'anim', duration: a.duration, tracks: a.tracks ? a.tracks.length : 0 }));
    }

    if (mixer) {
        try {
            const actions = mixer._actions || [];
            summary.mixerActions = actions.map(a => a.getClip ? a.getClip().name : 'action');
        } catch (e) {}
    }

    console.groupCollapsed(`Model Info: ${summary.rootName}`);
    console.log('Bounding Box:', summary.boundingBox);
    console.log('Object count:', summary.objectCount);
    console.groupCollapsed('Meshes (' + summary.meshes.length + ')');
    summary.meshes.forEach(m => {
        console.groupCollapsed(m.name);
        console.table({
            vertexCount: m.vertexCount,
            indexCount: m.indexCount,
            morphTargetCount: m.morphTargetCount,
            isSkinned: m.isSkinnedMesh,
            skeletonBoneCount: m.skeletonBoneCount,
            hasUVs: m.hasUVs,
            hasNormals: m.hasNormals,
            skinIndexAttr: m.skinIndexAttr,
            skinWeightAttr: m.skinWeightAttr,
            uniqueSkinIndices: m.uniqueSkinIndices || 0
        });
        console.log('Material:', m.material);
        console.groupEnd();
    });
    console.groupEnd();

    console.groupCollapsed('Materials (' + Object.keys(summary.materials).length + ')');
    Object.entries(summary.materials).forEach(([k, v]) => {
        console.log(k, v);
    });
    console.groupEnd();

    if (summary.skeletons.length) {
        console.groupCollapsed('Skeletons (' + summary.skeletons.length + ')');
        summary.skeletons.forEach(s => {
            console.log('Skinned Mesh:', s.skinnedMesh, 'Bone count:', s.boneCount);
            console.table(s.bones);
        });
        console.groupEnd(); 
    }

    if (Object.keys(summary.morphTargets).length) {
        console.groupCollapsed('Morph Targets');
        Object.entries(summary.morphTargets).forEach(([meshName, morphs]) => {
            console.log(meshName, morphs);
        });
        console.groupEnd();
    }

    if (summary.animations.length) {
        console.groupCollapsed('Animations (' + summary.animations.length + ')');
        summary.animations.forEach(a => console.log(a));
        console.groupEnd();
    }

    console.log('Full summary object (copyable):', summary);
    console.groupEnd();
}

//Left Arm length -------------

const sliderLeftArm = document.getElementById('leftArmLength');

sliderLeftArm.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('leftArmLengthValue').textContent = Math.floor(value);

    const leftArmChain = [
        'mixamorig9LeftArm',
        'mixamorig9LeftForeArm',
        'mixamorig9LeftHand'
    ];
    
    for (const meshName in bonesBooleans) {
        const meshBones = bonesBooleans[meshName]; 
        for (const boneName of leftArmChain) {
            if (meshBones[boneName]) {
                meshBones[boneName].scale.set(1, 1, 1);
            }
        }

        if (value <= 3) {
            if (meshBones['mixamorig9LeftHand']) {
                meshBones['mixamorig9LeftHand'].scale.set(0, 0, 0);
            }
        }
        if (value <= 2) {
            if (meshBones['mixamorig9LeftForeArm']) {
                meshBones['mixamorig9LeftForeArm'].scale.set(0, 0, 0);
            }
        }
        if (value <= 1) {
            if (meshBones['mixamorig9LeftArm']) { 
                meshBones['mixamorig9LeftArm'].scale.set(0, 0, 0);
            }
        }
    }
});

const sliderWeight = document.getElementById('morphSlider');

sliderWeight.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('morphSliderValue').textContent = Math.floor(value*10);

    const topsMesh = characterMeshes["sweater"]; 
    const bottomsMesh = characterMeshes["ch31_pants001"];
    
    console.log("Available meshes with morphs:", characterMeshes);

    if (topsMesh) {
        const dict = topsMesh.morphTargetDictionary;
        const influences = topsMesh.morphTargetInfluences;

        if (dict && dict["weight_sweater"] !== undefined) {
            influences[dict["weight_sweater"]] = value;
        } else {
            console.warn("not found");
        }
    }

    if (bottomsMesh) {
        const dict = bottomsMesh.morphTargetDictionary;
        const influences = bottomsMesh.morphTargetInfluences;

        if (dict && dict["weight_pants"] !== undefined) {
            influences[dict["weight_pants"]] = value;
        } else {
            console.warn("not found");
        }
    }
});

function setMaterialColor(material, hex, allowTextureTint = false) {
    const apply = (m) => {
        if (!m) return;
        
        if (!m.map || !m.map.image) {
            if (m.color) {
                m.color.set(hex);
            }
        } else if (allowTextureTint) {
            if (m.color) {
                m.color.set(hex);
            }
        }
        
        m.needsUpdate = true;
    };

    if (Array.isArray(material)) {
        material.forEach(apply);
    } else {
        apply(material);
    }
}

function updateSkinColor(hex) {
    console.log('Updating skin color for meshes:', skinMeshes.map(m => m.name));
    skinMeshes.forEach(mesh => {

        setMaterialColor(mesh.material, hex, true);
    });
}

function updateTshirtColor(hex) {
    console.log('Updating tshirt color for meshes:', tshirtMeshes.map(m => m.name));
    tshirtMeshes.forEach(mesh => {
        setMaterialColor(mesh.material, hex, true);
    });
}

document.getElementById('skinColorPicker').addEventListener('input', (e) => {
    const hex = e.target.value; 
    updateSkinColor(hex);
});

document.getElementById('tshirtColorPicker').addEventListener('input', (e) => {
    const hex = e.target.value; 
    updateTshirtColor(hex);
});

async function generateExercise() {
    try {
        document.querySelector('.final-btn').textContent = 'Generating...';
        document.querySelector('.final-btn').disabled = true;
        
        const config = {
            participant: '04',
            movement: 'squat',  
            setType: 'correct',
            camera: parseInt(document.getElementById('camera').value),
            fps: parseInt(document.getElementById('fps').value),
            saveName: document.getElementById('saveName').value
        };
        
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(config)
        });

        const result = await response.json();
        console.log("Result from generation: ", result)
        
    } catch (error) {
        console.error('Error generating exercise:', error);
        showError(`Network error: ${error.message}`, 'error');
    } finally {
        document.querySelector('.final-btn').textContent = 'Generate Animation';
        document.querySelector('.final-btn').disabled = false;
    }
}

function showError(message, type = 'error') {
    const errorEl = document.getElementById('errorMessage');
    errorEl.textContent = message;
    errorEl.className = `error-message ${type}`;
    errorEl.style.display = 'block';
    if (type === 'success') {
        setTimeout(() => errorEl.style.display = 'none', 8000);
    } else if (type === 'info') {
        setTimeout(() => errorEl.style.display = 'none', 3000);
    }
}

window.addEventListener('load', init);