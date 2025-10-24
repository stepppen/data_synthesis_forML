import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';


let renderer, scene, camera, loader, controls, fbx;

let skinMeshes = [];
let tshirtMeshes = [];
let hairMeshes = [];
let meshWithShapeKey = {};
let bonesBooleans = {};

let fbxModel = null;
let currentModel = null;

window.generateExercise = generateExercise;


function init() {
    const container = document.getElementById("viewer-container");

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 3);

    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(container.clientWidth, container.clientHeight);

    //shadows
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    //color space
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    //exposure and contrast
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    //PMREM = Prefiltered Mipmapped Radiance Environment Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    loader = new RGBELoader();
    loader.load("env/studio_hdr.hdr", 
        (texture) => {
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            scene.environment = envMap;
            scene.background = new THREE.Color(0xeeeeee);
            texture.dispose();
            pmremGenerator.dispose();
    },
    (error) => {
        scene.background = new THREE.Color(0xeeeeee);
    });

    //Orbit controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 3;
    controls.maxDistance = 3;
    controls.minAzimuthAngle = 5;
    controls.maxAzimuthAngle = -5;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI / 2;

    //Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.bias = -0.0001;
    scene.add(directionalLight);

    //Ground
    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0xeeeeee,
        roughness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    scene.add(ground);
    ground.receiveShadow = true;
    ground.position.y = 0;
    ground.rotation.x = -Math.PI / 2;

    loadCharacter("male");
    onWindowResize();
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    renderer.render(scene, camera);
}

function loadCharacter(characterType) {
    skinMeshes = [];
    tshirtMeshes = [];
    hairMeshes = [];
    meshWithShapeKey = {};
    bonesBooleans = {};

    const modeUrl = "data/w_keyShapes.fbx"

    const loader = new FBXLoader(fbx);
    loader.load(
        (modeUrl),
        fbx => {
            fbxModel = fbx;
            currentModel = fbx;

            const baseScale = 0.01;
            fbx.scale.setScalar(baseScale);

            //reposition model w/ b-box
            const box = new THREE.Box3().setFromObject(fbx); //computes smallest box around vertices
            const center = box.getCenter(new THREE.Vector3());
            fbx.position.sub(center); //move to 0,0,0
            const bboxMin = box.min.clone().sub(center);
            fbx.position.y -= bboxMin.y; //subtract y position of lowest vertex from model y position

            fbx.traverse(child => {
                if (!child.isMesh) return;
                child.castShadow = true;
                child.receiveShadow = true;

                //for shape keys
                if (child.morphTargetDictionary) {
                    meshWithShapeKey[child.name.toLowerCase()] = child;
                }
                                
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    
                    materials.forEach((mat, i) => {
                            //copy we can safely tweak
                        const newMat = mat.clone();
                        if (newMat.map && newMat.map.image) {
                                //converts to PBR rendering
                            newMat.map.colorSpace = THREE.SRGBColorSpace;
                            //re-upload texture to GPU
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
            tshirtMeshes = findTshirtMeshes(fbx);
            hairMeshes = findHairMeshes(fbx);
            skinMeshes = findSkinMeshes(fbx);
            bonesBooleans = {};
            bonesBooleans = findBones(fbx)

            scene.add(fbx);
        },
        (xhr) => {
            //random shit
        }, 
        (err) => {
            console.error(`Failed to load ${modeUrl}:`, err);
        }
    )
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

//Find Meshes functions----

function findTshirtMeshes(root){
    if(!root || typeof root.traverse !== "function") [];
    const candidates = [];
    root.traverse(child => {
        if (!child.isMesh) return;
        const name = (child.name || "").toLowerCase();
        const matName = (child.name && child.material.name || "").toLowerCase();

        if (
            name.includes("tops") ||
            name.includes("sweater") ||
            name.includes("top") ||
            name.includes("tshirt") ||
            name.includes("shirt") ||
            matName.includes("tshirt") ||
            matName.includes("shirt")
        ){
            candidates.push(child);
        }
    })
    return candidates
}

function findHairMeshes(root){
    if(!root || typeof root.traverse !== "function") [];
    const candidates = [];
    root.traverse(child => {
        if (!child.isMesh) return;
        const name = (child.name || "").toLowerCase();
        const matName = (child.name && child.material.name || "").toLowerCase();

        if (
            matName.includes("Ch31_Hair001") ||
            (name.match(/^ch\d+_hair001/i))
        ){
            candidates.push(child);
        }
    })
    return candidates
}

function findSkinMeshes(root){
    if(!root || typeof root.traverse !== "function") [];
    const candidates = [];
    root.traverse(child => {
        if (!child.isMesh) return;
        const name = (child.name || "").toLowerCase();
        const matName = (child.name && child.material.name || "").toLowerCase();
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

        if (isSkin && !isClothing){
            candidates.push(child);
        }
    })
    return candidates
}


function findBones(root){
    if(!root || typeof root.traverse !== "function") [];
    const candidates = {}
    root.traverse(child => {
        if (!child.isSkinnedMesh && !child.skeleton) return;
        candidates[child.name] = {};
        for (let bone of child.skeleton.bones){
            candidates[child.name][bone.name] = bone;
        }
    })
    return candidates
}


//UI Input functions
document.getElementById("defaultHair").addEventListener("click", toggleDefaultHair);
document.getElementById("customHair").addEventListener("click", toggleCustomHair);

function toggleHair(visible) {
    if (!Array.isArray(hairMeshes) || !hairMeshes.length){
        console.warn("Not enough hair meshes found");
        return;
    }
    hairMeshes[0].visible = !!visible
    renderer.render(scene, camera);
}

function toggleDefaultHair() {
    toggleHair(false);
}
function toggleCustomHair() {
    toggleHair(true);
}



document.getElementById("defaultTshirt").addEventListener("click", toggleDefaultShirt);
document.getElementById("customTshirt").addEventListener("click", toggleCustomShirt);

function toggleShirt(visible) {
    if (!Array.isArray(tshirtMeshes) || !tshirtMeshes.length){
        console.warn("Not enough shirt meshes found");
        return;
    }
    tshirtMeshes[0].visible = !!visible
    renderer.render(scene, camera);
}

function toggleDefaultShirt() {
    toggleShirt(false);
}
function toggleCustomShirt() {
    toggleShirt(true);
}



document.getElementById("leftArmLength").addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById("leftArmLengthValue").textContent = Math.floor(value);

    const leftArmChain = [
        'mixamorig9LeftArm',
        'mixamorig9LeftForeArm',
        'mixamorig9LeftHand'
    ];

    for (const meshName in bonesBooleans){
        const meshBones = bonesBooleans[meshName];
        for (const bones of leftArmChain){
            if(meshBones[bones]){
                meshBones[bones].scale.set(1, 1, 1);
            }
        }
        if ( value <= 3 ) {
            if(meshBones["mixamorig9LeftHand"]){
                meshBones["mixamorig9LeftHand"].scale.set(0, 0, 0);
            }
        }
        if ( value <= 2 ) {
            if(meshBones["mixamorig9LeftForeArm"]){
                meshBones["mixamorig9LeftForeArm"].scale.set(0, 0, 0);
            }
        }
        if ( value <= 1 ) {
            if(meshBones["mixamorig9LeftArm"]){
                meshBones["mixamorig9LeftArm"].scale.set(0, 0, 0);
            }
        }
    }
});

document.getElementById("morphSlider").addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById("morphSliderValue").textContent = Math.floor(value);

    const topsMesh = meshWithShapeKey["sweater"];
    const bottomsMesh = meshWithShapeKey["ch31_pants001"];

    if(topsMesh){
        const dict = topsMesh.morphTargetDictionary;
        const influences = topsMesh.morphTargetInfluences; 

        if (dict && dict["weight_sweater"] !== undefined){
            influences[dict["weight_sweater"]] = value;
        } else {
            console.warn("not found");
        }
    }
    if(bottomsMesh){
        const dict = topsMesh.morphTargetDictionary;
        const influences = topsMesh.morphTargetInfluences; 

        if (dict && dict["weight_sweater"] !== undefined){
            influences[dict["weight_sweater"]] = value;
        } else {
            console.warn("not found");
        }
    }


});


document.getElementById("skinColorPicker").addEventListener("input", (e) => {
    const hex = e.target.value;
    skinMeshes.forEach( mesh => {
    setMaterialColor(mesh.material, hex, true);
    })
});
document.getElementById("tshirtColorPicker").addEventListener("input", (e) => {
    const hex = e.target.value;
    tshirtMeshes.forEach( mesh => {
        setMaterialColor(mesh.material, hex, true);
    })
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
    if (Array.isArray(material)){
        material.forEach(apply);
    } else {
        apply(material);
    }
}

async function generateExercise(){
    try{
        document.querySelector("final-btn").textContent = "Generating..."
        const config = {
            participant: "04",
            movement: "squat",
            set_type: "correct",
            camera: "04",
            fps: "30",
            save_name: "test"
        }

        const response = await fetch("/api/generate", {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(config),
        })
        const result = await response.json();
        console.log("Response from server: ", result);
    } catch (err) {
        console.log("Error w server: ", err);

    } finally {
        document.querySelector("final-btn").textContent = "Generate Animation"
    }
}



window.addEventListener("load", init);
