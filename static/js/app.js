import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

let scene, camera, renderer, controls;
let currentModel = null;
let meshWithShapeKey = {};
let bonesBooleans = {};
let skinMeshes = [];
let tshirtMeshes = [];
let hairMeshes = [];
let fbxModel = null;

//expose functions to global window -> can be called by html
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
    //exposure and contrast
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    //renderer creates an actual <canvas>
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

//redraw every frame
function animate() {
    //after frame is rendered, animate is called again
    requestAnimationFrame(animate);
    if (controls) controls.update();
    renderer.render(scene, camera);
}


// Traversing fbx model ---------------------------

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
        }
    });
    return candidates;
}


function findBones(root) {
    if (!root || typeof root.traverse !== 'function') return [];
    const candidates = {};
    root.traverse((child) => {
        if (child.isSkinnedMesh && child.skeleton) {
            //new property on the candidates object
            candidates[child.name] = {}; 
            for (const bone of child.skeleton.bones) {
                candidates[child.name][bone.name] = bone;
            }
        }
    });
    return candidates;
}

function loadCharacter(characterType) {
    if (currentModel) {
        scene.remove(currentModel);
        currentModel = null;
    }
    skinMeshes = [];
    tshirtMeshes = [];
    hairMeshes = [];
    meshWithShapeKey = {};
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
        //second param -> defines onLoad
        //pass downloaded model as argument to onLoad arrow function
        (fbx) => {
            fbxModel = fbx;
            currentModel = fbx;

            const baseScale = 0.01;
            fbx.scale.setScalar(baseScale);

            //reposition model using bounding box
            const box = new THREE.Box3().setFromObject(fbx); //computes smallest box around vertices
            const center = box.getCenter(new THREE.Vector3());
            fbx.position.sub(center); //move to 0,0,0
            const bboxMin = box.min.clone().sub(center);
            fbx.position.y -= bboxMin.y; //subtract y position of lowest vertex from model y position

            fbx.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = true;
                child.receiveShadow = true;

                //for shape keys
                if (child.morphTargetDictionary) {
                    meshWithShapeKey[child.name.toLowerCase()] = child;
                }

                if (child.material) {
                    //ensures materials is always an array
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    
                    materials.forEach((mat, i) => {
                        const newMat = mat.clone();
                        //converts to PBR rendering
                        if (newMat.map && newMat.map.image) {
                            newMat.map.colorSpace = THREE.SRGBColorSpace;
                            newMat.map.needsUpdate = true;
                        }
                        
                        if (newMat.roughness === undefined) newMat.roughness = 0.7;
                        if (newMat.metalness === undefined) newMat.metalness = 0.1;
                        
                        //if fbx export includes MeshPhong or MeshLambert a.s.o
                        if (newMat.type !== 'MeshStandardMaterial') {
                            const standardMat = new THREE.MeshStandardMaterial({
                                map: newMat.map,
                                color: newMat.color || 0xffffff,
                                roughness: 0.7,
                                metalness: 0.1,
                                normalMap: newMat.normalMap,
                                name: newMat.name
                            });
                            
                            if (Array.isArray(child.material)) {
                                child.material[i] = standardMat;
                            } else {
                                child.material = standardMat;
                            }
                        } 
                        //if already a standard material
                        else {
                            if (Array.isArray(child.material)) {
                                child.material[i] = newMat;
                            } else {
                                child.material = newMat;
                            }
                        }
                    });
                }
            });
            
            bonesBooleans = {};
            bonesBooleans = findBones(fbx);
            tshirtMeshes = findTshirtMeshes(fbx);
            hairMeshes = findHairMeshes(fbx);
            skinMeshes = findSkinMeshes(fbx);

            scene.add(fbx);

            if (overlay) overlay.style.display = 'none';
            console.log(`Loaded model '${modelUrl}' — skin meshes: ${skinMeshes.length}, tshirt meshes: ${tshirtMeshes.length}`);
            console.log('Skin meshes:', skinMeshes.map(m => m.name));
            console.log('Tshirt meshes:', tshirtMeshes.map(m => m.name));
            console.log('Hair meshes:', hairMeshes.map(m => m.name));
        },
        // onProgress CB
        (xhr) => {
        },
        (err) => {
            console.error(`Failed to load ${modelUrl}:`, err);
            if (overlay) overlay.style.display = 'none';
        }
    );
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
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



//shirt selection -----

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

//Weight selection ------------
const sliderWeight = document.getElementById('morphSlider');

sliderWeight.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('morphSliderValue').textContent = Math.floor(value*10);

    const topsMesh = meshWithShapeKey["sweater"]; 
    const bottomsMesh = meshWithShapeKey["ch31_pants001"];
    
    console.log("Available meshes with morphs:", meshWithShapeKey);

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


// Skin color picker -----------
document.getElementById('skinColorPicker').addEventListener('input', (e) => {
    const hex = e.target.value; 
    updateSkinColor(hex);
});

function updateSkinColor(hex) {
    console.log('Updating skin color for meshes:', skinMeshes.map(m => m.name));
    skinMeshes.forEach(mesh => {
        setMaterialColor(mesh.material, hex, true);
    });
}

// Tshirt color picker -----------
document.getElementById('tshirtColorPicker').addEventListener('input', (e) => {
    const hex = e.target.value; 
    updateTshirtColor(hex);
});

function updateTshirtColor(hex) {
    console.log('Updating tshirt color for meshes:', tshirtMeshes.map(m => m.name));
    tshirtMeshes.forEach(mesh => {
        setMaterialColor(mesh.material, hex, true);
    });
}

//general material color changer
function setMaterialColor(material, hex, allowTextureTint = false) {
    const apply = m => {
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



//check what fbx model holds -----------
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


//send config using btn -------
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
        
        //pause execution until data comes back; otherwise promise will result in pending
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(config)
        });

        //pauses only the async function until promise settles -> resolve or reject
        const result = await response.json();
        console.log("Result: ", result)
        
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

//on load => init
window.addEventListener('load', init);