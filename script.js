import { NRRDLoader } from 'three/addons/loaders/NRRDLoader.js';

let scene, camera, renderer, controls;
let heartMesh, clippingPlanes = [];
let planeHelpers = [];
let floor;

// NRRD model variables
let nrrdMesh, nrrdClippingPlanes = [];
let nrrdPlaneHelpers = [];
let nrrdVolume = null;
let nrrdSlices = [];

// Relative perspective clipping variables
let isRelativeCameraClipping = false;
let relativeClippingPlane = null;
let relativeClippingHelper = null;
let lockedCameraNormal = null;
let relativeClippingDepth = 0;

// Auto adjustment variables
let isAutoDepth = false;
let autoDepthDirection = 1; // 1: forward (increase), -1: backward (decrease)
let autoDepthSpeed = 0.5; // Movement speed per frame

// FPS counter variables
let fps = 0;
let frameCount = 0;
let lastTime = performance.now();

// Create AR button
function createARButton() {
    const button = document.createElement('button');
    button.id = 'ARButton';
    button.style.cssText = `
        position: absolute;
        bottom: 20px;
        right: 20px;
        padding: 12px 24px;
        background: rgba(76, 175, 80, 0.9);
        color: white;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 8px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        z-index: 999;
        font-family: Arial, sans-serif;
    `;

    function showStartAR() {
        let currentSession = null;

        async function onSessionStarted(session) {
            session.addEventListener('end', onSessionEnded);
            await renderer.xr.setSession(session);
            button.textContent = 'EXIT AR';
            currentSession = session;
        }

        function onSessionEnded() {
            currentSession.removeEventListener('end', onSessionEnded);
            button.textContent = 'START AR';
            currentSession = null;
        }

        button.textContent = 'START AR';
        button.onclick = function() {
            if (currentSession === null) {
                const sessionInit = {
                    requiredFeatures: ['hit-test'],
                    optionalFeatures: ['dom-overlay'],
                    domOverlay: { root: document.body }
                };
                navigator.xr.requestSession('immersive-ar', sessionInit)
                    .then(onSessionStarted)
                    .catch((err) => {
                        console.error('AR Session Error:', err);
                        alert('Unable to start AR mode: ' + err.message);
                    });
            } else {
                currentSession.end();
            }
        };
    }

    function showARNotSupported() {
        // When AR is not supported, don't show button
        button.remove();
    }

    if ('xr' in navigator) {
        navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
            if (supported) {
                showStartAR();
                document.body.appendChild(button);
            } else {
                showARNotSupported();
            }
        }).catch(() => {
            showARNotSupported();
        });
    } else {
        showARNotSupported();
    }
}

function init() {
    // Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;

    // AR mode settings
    renderer.xr.enabled = true;

    document.getElementById('container').appendChild(renderer.domElement);

    // Check AR support and set background
    checkARSupportAndSetBackground();

    // Create AR button
    createARButton();

    createOrbitControls();

    createClippingPlanes();

    addLights();

    addFloor();

    setupEventListeners();

    // Load default model
    loadDefaultSTL();

    animate();
}

function checkARSupportAndSetBackground() {
    if ('xr' in navigator) {
        navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
            if (supported) {
                scene.background = null;
                renderer.setClearColor(0x000000, 0);
            } else {
                scene.background = new THREE.Color(0x1A1A1A);
                renderer.setClearColor(0x1A1A1A, 1);
            }
        }).catch(() => {
            scene.background = new THREE.Color(0x1A1A1A);
            renderer.setClearColor(0x1A1A1A, 1);
        });
    } else {
        // WebXR not supported
        scene.background = new THREE.Color(0x1A1A1A);
        renderer.setClearColor(0x1A1A1A, 1);
    }
}

function createOrbitControls() {
    // Simplified orbit control implementation
    let isMouseDown = false;
    let mouseButton = 0;
    let previousMousePosition = { x: 0, y: 0 };

    // Touch-related variables
    let touches = [];
    let previousTouches = [];
    let initialPinchDistance = 0;

    // === Mouse events ===
    renderer.domElement.addEventListener('mousedown', (event) => {
        isMouseDown = true;
        mouseButton = event.button;
        previousMousePosition = { x: event.clientX, y: event.clientY };
    });

    renderer.domElement.addEventListener('mouseup', () => {
        isMouseDown = false;
    });

    renderer.domElement.addEventListener('mousemove', (event) => {
        if (!isMouseDown) return;

        const deltaMove = {
            x: event.clientX - previousMousePosition.x,
            y: event.clientY - previousMousePosition.y
        };

        if (mouseButton === 0) { // Rotate camera
            const spherical = new THREE.Spherical();
            spherical.setFromVector3(camera.position);
            spherical.theta -= deltaMove.x * 0.005;
            spherical.phi -= deltaMove.y * 0.005;
            spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
            camera.position.setFromSpherical(spherical);
            camera.lookAt(0, 0, 0);
        } else if (mouseButton === 2) { // Pan view
            const factor = camera.position.length() * 0.001;

            // Get camera's local coordinate system vectors
            const right = new THREE.Vector3();
            const up = new THREE.Vector3();
            const forward = new THREE.Vector3();

            // Update camera matrix and extract basis vectors
            camera.updateMatrixWorld();
            camera.matrix.extractBasis(right, up, forward);

            // Move along camera's local X and Y axes based on mouse movement
            camera.position.addScaledVector(right, -deltaMove.x * factor);
            camera.position.addScaledVector(up, deltaMove.y * factor);
        }

        previousMousePosition = { x: event.clientX, y: event.clientY };
    });

    renderer.domElement.addEventListener('wheel', (event) => {
        event.preventDefault();
        const factor = event.deltaY > 0 ? 1.1 : 0.9;
        camera.position.multiplyScalar(factor);
    });

    renderer.domElement.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    // === Touch events ===
    renderer.domElement.addEventListener('touchstart', (event) => {
        event.preventDefault();
        touches = Array.from(event.touches);
        previousTouches = touches.map(t => ({ x: t.clientX, y: t.clientY }));

        // If two fingers, record initial distance
        if (touches.length === 2) {
            initialPinchDistance = getTouchDistance(touches[0], touches[1]);
        }
    }, { passive: false });

    renderer.domElement.addEventListener('touchmove', (event) => {
        event.preventDefault();
        touches = Array.from(event.touches);

        if (touches.length === 1 && previousTouches.length === 1) {
            // Single finger drag → Rotate model
            const deltaMove = {
                x: touches[0].clientX - previousTouches[0].x,
                y: touches[0].clientY - previousTouches[0].y
            };

            const spherical = new THREE.Spherical();
            spherical.setFromVector3(camera.position);
            spherical.theta -= deltaMove.x * 0.005;
            spherical.phi -= deltaMove.y * 0.005;
            spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
            camera.position.setFromSpherical(spherical);
            camera.lookAt(0, 0, 0);

        } else if (touches.length === 2 && previousTouches.length === 2) {
            // Two-finger pinch/spread → Zoom
            const currentDistance = getTouchDistance(touches[0], touches[1]);
            const previousDistance = getTouchDistance(
                { clientX: previousTouches[0].x, clientY: previousTouches[0].y },
                { clientX: previousTouches[1].x, clientY: previousTouches[1].y }
            );

            if (previousDistance > 0) {
                const scale = currentDistance / previousDistance;
                const zoomFactor = scale > 1 ? 0.98 : 1.02;
                camera.position.multiplyScalar(zoomFactor);
            }

            // Two-finger drag → Pan view
            const currentCenter = getTouchCenter(touches[0], touches[1]);
            const previousCenter = {
                x: (previousTouches[0].x + previousTouches[1].x) / 2,
                y: (previousTouches[0].y + previousTouches[1].y) / 2
            };

            const deltaMove = {
                x: currentCenter.x - previousCenter.x,
                y: currentCenter.y - previousCenter.y
            };

            const factor = camera.position.length() * 0.001;
            const right = new THREE.Vector3();
            const up = new THREE.Vector3();

            camera.updateMatrixWorld();
            camera.matrix.extractBasis(right, up, new THREE.Vector3());

            camera.position.addScaledVector(right, -deltaMove.x * factor);
            camera.position.addScaledVector(up, deltaMove.y * factor);
        }

        previousTouches = touches.map(t => ({ x: t.clientX, y: t.clientY }));
    }, { passive: false });

    renderer.domElement.addEventListener('touchend', (event) => {
        event.preventDefault();
        touches = Array.from(event.touches);
        previousTouches = touches.map(t => ({ x: t.clientX, y: t.clientY }));

        if (touches.length < 2) {
            initialPinchDistance = 0;
        }
    }, { passive: false });

    // Helper function: Calculate distance between two points
    function getTouchDistance(touch1, touch2) {
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Helper function: Calculate center of two points
    function getTouchCenter(touch1, touch2) {
        return {
            x: (touch1.clientX + touch2.clientX) / 2,
            y: (touch1.clientY + touch2.clientY) / 2
        };
    }
}

function createClippingPlanes() {
    clippingPlanes = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), 25),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), 25),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), 25)
    ];

    // Create plane helper display
    planeHelpers = clippingPlanes.map((plane, index) => {
        const helper = new THREE.PlaneHelper(plane, 50, [0xFF7043, 0x26A69A, 0x7986CB][index]);
        helper.visible = false;
        scene.add(helper);
        return helper;
    });

    // Create relative perspective clipping plane
    relativeClippingPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    relativeClippingHelper = new THREE.PlaneHelper(relativeClippingPlane, 50, 0xFFEB3B);
    relativeClippingHelper.visible = false;
    scene.add(relativeClippingHelper);

    // Create NRRD clipping planes (independent)
    nrrdClippingPlanes = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), 25),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), 25),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), 25)
    ];

    // Create NRRD plane helper display
    nrrdPlaneHelpers = nrrdClippingPlanes.map((plane, index) => {
        const helper = new THREE.PlaneHelper(plane, 50, [0xFFAA00, 0x00AAFF, 0xAA00FF][index]);
        helper.visible = false;
        scene.add(helper);
        return helper;
    });
}

function addLights() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);

    directionalLight.position.set(30, 112, 30);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    scene.add(directionalLight);

    // Fill light (from bottom left)
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-50, -30, -50);
    scene.add(fillLight);

    // Top light source
    const topLight = new THREE.PointLight(0xffffff, 0.5);
    topLight.position.set(0, 80, 0);
    scene.add(topLight);
}

function addFloor() {
    // Create floor geometry
    const floorGeometry = new THREE.PlaneGeometry(100, 100);
    const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x808080,  // Gray
        roughness: 0.8,
        metalness: 0.2,
        side: THREE.DoubleSide,
        // Floor is not clipped but receives shadows from clipped objects
        clipShadows: true
    });

    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;    // Rotate plane to horizontal
    floor.position.y = -30;             // Place below model
    floor.receiveShadow = true;
    scene.add(floor);
}

function createDefaultHeart() {
    // Create a heart-shaped geometry as an example
    const heartGeometry = new THREE.BufferGeometry();
    const vertices = [];
    const normals = [];

    // Simplified heart shape generation
    for (let i = 0; i < 100; i++) {
        for (let j = 0; j < 100; j++) {
            const u = (i / 99) * Math.PI * 2;
            const v = (j / 99) * Math.PI;

            // Heart parametric equation
            const x = 16 * Math.sin(u) ** 3;
            const y = 13 * Math.cos(u) - 5 * Math.cos(2*u) - 2 * Math.cos(3*u) - Math.cos(4*u);
            const z = Math.sin(v) * 10;

            vertices.push(x, y, z);

            // Simple normal vector calculation
            const normal = new THREE.Vector3(x, y, z).normalize();
            normals.push(normal.x, normal.y, normal.z);
        }
    }

    heartGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    heartGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    const material = new THREE.MeshStandardMaterial({
        color: 0xff6b6b,
        roughness: 0.5,
        metalness: 0.1,
        side: THREE.DoubleSide,
        clippingPlanes: clippingPlanes,
        clipShadows: true  // Let shadows be cut too
    });

    heartMesh = new THREE.Points(heartGeometry, material);
    heartMesh.castShadow = true;
    heartMesh.receiveShadow = true;
    scene.add(heartMesh);
}

function loadDefaultSTL() {
    // Load default STL model
    document.getElementById('loadingIndicator').style.display = 'block';

    fetch('pid_1000.stl')
        .then(response => {
            if (!response.ok) {
                throw new Error('Unable to load default model');
            }
            return response.arrayBuffer();
        })
        .then(buffer => {
            try {
                const geometry = parseSTL(buffer);
                createMeshFromGeometry(geometry);
                document.getElementById('loadingIndicator').style.display = 'none';
            } catch (error) {
                console.error('Default STL file loading error:', error);
                document.getElementById('loadingIndicator').style.display = 'none';
            }
        })
        .catch(error => {
            console.error('Unable to load default model:', error);
            document.getElementById('loadingIndicator').style.display = 'none';
        });
}

function loadSTL(file) {
    document.getElementById('loadingIndicator').style.display = 'block';

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const contents = event.target.result;
            const geometry = parseSTL(contents);
            createMeshFromGeometry(geometry);
            document.getElementById('loadingIndicator').style.display = 'none';

        } catch (error) {
            console.error('STL file loading error:', error);
            alert('Error loading STL file. Please confirm the file format is correct.');
            document.getElementById('loadingIndicator').style.display = 'none';
        }
    };

    reader.readAsArrayBuffer(file);
}

function createMeshFromGeometry(geometry) {
    // Remove old model
    if (heartMesh) {
        scene.remove(heartMesh);
    }

    // Calculate geometry bounding box for proper scaling
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 50 / maxDim; // Scale to appropriate size

    // Center geometry
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(scale, scale, scale);

    // Calculate normals
    geometry.computeVertexNormals();

    // Create material
    const material = new THREE.MeshStandardMaterial({
        color: 0xff6b6b,
        roughness: 0.5,
        metalness: 0.1,
        side: THREE.DoubleSide,
        clippingPlanes: clippingPlanes,
        clipShadows: true  // Let shadows be cut too
    });

    // Create mesh
    heartMesh = new THREE.Mesh(geometry, material);
    heartMesh.castShadow = true;
    heartMesh.receiveShadow = true;
    scene.add(heartMesh);
}

function parseSTL(buffer) {
    const dataView = new DataView(buffer);

    // Check if binary STL (first 80 bytes are header, bytes 81-84 are triangle count)
    if (buffer.byteLength > 84) {
        const triangleCount = dataView.getUint32(80, true);
        const expectedSize = 80 + 4 + triangleCount * 50;

        if (buffer.byteLength >= expectedSize) {
            return parseBinarySTL(dataView, triangleCount);
        }
    }

    // If not binary STL, try to parse as ASCII STL
    const text = new TextDecoder().decode(buffer);
    return parseAsciiSTL(text);
}

function parseBinarySTL(dataView, triangleCount) {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const normals = [];

    let offset = 84; // Skip header and triangle count

    for (let i = 0; i < triangleCount; i++) {
        // Normal vector
        const nx = dataView.getFloat32(offset, true);
        const ny = dataView.getFloat32(offset + 4, true);
        const nz = dataView.getFloat32(offset + 8, true);

        // Three vertices
        for (let j = 0; j < 3; j++) {
            const vertexOffset = offset + 12 + j * 12;
            const x = dataView.getFloat32(vertexOffset, true);
            const y = dataView.getFloat32(vertexOffset + 4, true);
            const z = dataView.getFloat32(vertexOffset + 8, true);

            vertices.push(x, y, z);
            normals.push(nx, ny, nz);
        }

        offset += 50; // Each triangle occupies 50 bytes
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    return geometry;
}

function parseAsciiSTL(text) {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const normals = [];

    const lines = text.split('\n');
    let currentNormal = null;

    for (let line of lines) {
        line = line.trim();

        if (line.startsWith('facet normal')) {
            const parts = line.split(/\s+/);
            currentNormal = [
                parseFloat(parts[2]),
                parseFloat(parts[3]),
                parseFloat(parts[4])
            ];
        } else if (line.startsWith('vertex')) {
            const parts = line.split(/\s+/);
            vertices.push(
                parseFloat(parts[1]),
                parseFloat(parts[2]),
                parseFloat(parts[3])
            );
            if (currentNormal) {
                normals.push(...currentNormal);
            }
        }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    if (normals.length > 0) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    }

    return geometry;
}

// NRRD file loading function
function loadNRRD(file) {
    document.getElementById('loadingIndicator').style.display = 'block';

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const loader = new NRRDLoader();

            // Create a blob URL from the file
            const blob = new Blob([event.target.result]);
            const url = URL.createObjectURL(blob);

            // Load the NRRD file
            loader.load(url, function(volume) {
                console.log('NRRD file loaded successfully:', file.name);
                console.log('Volume dimensions:', volume.xLength, volume.yLength, volume.zLength);

                nrrdVolume = volume;
                createNRRDVisualization(volume);

                document.getElementById('loadingIndicator').style.display = 'none';

                // Clean up blob URL
                URL.revokeObjectURL(url);
            }, undefined, function(error) {
                console.error('NRRD loading error:', error);
                alert('Error loading NRRD file: ' + error.message);
                document.getElementById('loadingIndicator').style.display = 'none';
            });
        } catch (error) {
            console.error('NRRD file loading error:', error);
            alert('Error loading NRRD file. Please confirm the file format is correct.');
            document.getElementById('loadingIndicator').style.display = 'none';
        }
    };

    reader.readAsArrayBuffer(file);
}

function createNRRDVisualization(volume) {
    // Remove old NRRD meshes
    nrrdSlices.forEach(slice => scene.remove(slice));
    nrrdSlices = [];

    if (nrrdMesh) {
        scene.remove(nrrdMesh);
    }

    // Create bounding box to show volume dimensions
    const geometry = new THREE.BoxGeometry(
        volume.RASDimensions[0],
        volume.RASDimensions[1],
        volume.RASDimensions[2]
    );

    const boxMaterial = new THREE.MeshBasicMaterial({
        color: 0x6b6bff,
        wireframe: true,
        opacity: 0.3,
        transparent: true
    });

    nrrdMesh = new THREE.Mesh(geometry, boxMaterial);
    nrrdMesh.position.set(40, 0, 0); // Offset to the side
    scene.add(nrrdMesh);

    // Extract and display slices
    const sliceZ = Math.floor(volume.zLength / 2);
    const sliceY = Math.floor(volume.yLength / 2);
    const sliceX = Math.floor(volume.xLength / 2);

    // Create Z slice (axial)
    createNRRDSlice(volume, 'z', sliceZ);

    // Create Y slice (coronal)
    createNRRDSlice(volume, 'y', sliceY);

    // Create X slice (sagittal)
    createNRRDSlice(volume, 'x', sliceX);
}

function createNRRDSlice(volume, axis, index) {
    const slice = volume.extractSlice(axis, index);

    const canvas = document.createElement('canvas');
    canvas.width = slice.iLength;
    canvas.height = slice.jLength;

    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(slice.iLength, slice.jLength);

    // Map volume data to image data
    for (let i = 0; i < slice.iLength; i++) {
        for (let j = 0; j < slice.jLength; j++) {
            const idx = (j * slice.iLength + i) * 4;
            const value = slice.data[j * slice.iLength + i];

            // Normalize value to 0-255 range
            const normalized = Math.floor((value / 255) * 255);

            imgData.data[idx] = normalized;     // R
            imgData.data[idx + 1] = normalized; // G
            imgData.data[idx + 2] = normalized; // B
            imgData.data[idx + 3] = 255;        // A
        }
    }

    ctx.putImageData(imgData, 0, 0);

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    // Create plane geometry
    const planeGeo = new THREE.PlaneGeometry(
        slice.planeWidth,
        slice.planeHeight
    );

    const planeMat = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        clippingPlanes: nrrdClippingPlanes,
        clipShadows: true
    });

    const planeMesh = new THREE.Mesh(planeGeo, planeMat);

    // Position the slice
    planeMesh.position.copy(slice.mesh.position).add(new THREE.Vector3(40, 0, 0));
    planeMesh.rotation.copy(slice.mesh.rotation);

    scene.add(planeMesh);
    nrrdSlices.push(planeMesh);
}

// Sidebar collapse/expand
function setupEventListeners() {
    const toggleBtn = document.getElementById('toggleSidebar');
    const collapseBtn = document.getElementById('collapseBtn');
    const controls = document.getElementById('controls');
    let isCollapsed = false;

    function toggleSidebar() {
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
            controls.classList.add('collapsed');
            toggleBtn.classList.remove('sidebar-expanded');
            toggleBtn.classList.add('sidebar-collapsed');
            toggleBtn.style.display = 'flex';
        } else {
            controls.classList.remove('collapsed');
            toggleBtn.classList.remove('sidebar-collapsed');
            toggleBtn.classList.add('sidebar-expanded');
            toggleBtn.style.display = 'none';
        }
    }

    toggleBtn.addEventListener('click', toggleSidebar);
    collapseBtn.addEventListener('click', toggleSidebar);

    // Initially hide expand button
    toggleBtn.style.display = 'none';

    // NRRD sidebar controls
    const toggleNrrdBtn = document.getElementById('toggleNrrdSidebar');
    const collapseNrrdBtn = document.getElementById('collapseNrrdBtn');
    const nrrdControls = document.getElementById('nrrdControls');
    let isNrrdCollapsed = false;

    function toggleNrrdSidebar() {
        isNrrdCollapsed = !isNrrdCollapsed;
        if (isNrrdCollapsed) {
            nrrdControls.classList.add('collapsed');
            toggleNrrdBtn.classList.remove('sidebar-expanded');
            toggleNrrdBtn.classList.add('sidebar-collapsed');
            toggleNrrdBtn.style.display = 'flex';
        } else {
            nrrdControls.classList.remove('collapsed');
            toggleNrrdBtn.classList.remove('sidebar-collapsed');
            toggleNrrdBtn.classList.add('sidebar-expanded');
            toggleNrrdBtn.style.display = 'none';
        }
    }

    toggleNrrdBtn.addEventListener('click', toggleNrrdSidebar);
    collapseNrrdBtn.addEventListener('click', toggleNrrdSidebar);

    // Initially hide NRRD expand button
    toggleNrrdBtn.style.display = 'none';

    // File input
    document.getElementById('fileInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file && file.name.toLowerCase().endsWith('.stl')) {
            loadSTL(file);
        }
    });

    // NRRD file input
    document.getElementById('nrrdFileInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file && file.name.toLowerCase().endsWith('.nrrd')) {
            loadNRRD(file);
        }
    });

    // Clipping control
    ['clipX', 'clipY', 'clipZ'].forEach((id, index) => {
        const slider = document.getElementById(id);
        const valueDisplay = document.getElementById(id + 'Value');

        slider.addEventListener('input', () => {
            const value = parseFloat(slider.value);
            valueDisplay.textContent = value.toFixed(1);
            clippingPlanes[index].constant = value;
        });
    });

    // NRRD Clipping control (independent)
    ['nrrdClipX', 'nrrdClipY', 'nrrdClipZ'].forEach((id, index) => {
        const slider = document.getElementById(id);
        const valueDisplay = document.getElementById(id + 'Value');

        slider.addEventListener('input', () => {
            const value = parseFloat(slider.value);
            valueDisplay.textContent = value.toFixed(1);
            nrrdClippingPlanes[index].constant = value;
        });
    });

    // Enable/disable clipping
    document.getElementById('enableClipping').addEventListener('change', (event) => {
        if (event.target.checked) {
            // When absolute clipping is checked, automatically disable relative clipping
            const relativeCameraClippingCheckbox = document.getElementById('relativeCameraClipping');
            if (relativeCameraClippingCheckbox.checked) {
                relativeCameraClippingCheckbox.checked = false;
                // Trigger relative clipping change event to update state
                relativeCameraClippingCheckbox.dispatchEvent(new Event('change'));
            }
        }
        if (heartMesh) {
            heartMesh.material.clippingPlanes = event.target.checked ? clippingPlanes : [];
            heartMesh.material.clipShadows = event.target.checked;
            heartMesh.material.needsUpdate = true;
        }
    });

    // Show clipping plane
    document.getElementById('showPlanes').addEventListener('change', (event) => {
        if (isRelativeCameraClipping) {
            // Relative perspective mode: Show relative clipping plane
            relativeClippingHelper.visible = event.target.checked;
        } else {
            // World space mode: Show world space planes
            planeHelpers.forEach(helper => {
                helper.visible = event.target.checked;
            });
        }
    });

    // Wireframe mode
    document.getElementById('wireframe').addEventListener('change', (event) => {
        if (heartMesh) {
            heartMesh.material.wireframe = event.target.checked;
        }
    });

    // Show/hide floor
    document.getElementById('showFloor').addEventListener('change', (event) => {
        if (floor) {
            floor.visible = event.target.checked;
        }
    });

    // Relative perspective clipping mode toggle
    document.getElementById('relativeCameraClipping').addEventListener('change', (event) => {
        if (event.target.checked) {
            // When relative clipping is checked, automatically disable absolute clipping
            const enableClippingCheckbox = document.getElementById('enableClipping');
            if (enableClippingCheckbox.checked) {
                enableClippingCheckbox.checked = false;
                // Trigger absolute clipping change event to update state
                enableClippingCheckbox.dispatchEvent(new Event('change'));
            }
        }

        isRelativeCameraClipping = event.target.checked;
        const relativeControls = document.getElementById('relativeClippingControls');
        const showPlanesCheckbox = document.getElementById('showPlanes');

        if (isRelativeCameraClipping) {
            // Enable relative perspective clipping
            relativeControls.classList.add('active');

            // Switch to relative perspective clipping plane
            if (heartMesh) {
                heartMesh.material.clippingPlanes = [relativeClippingPlane];
                heartMesh.material.clipShadows = true;
                heartMesh.material.needsUpdate = true;
            }

            // Floor should not be clipped - do not set clippingPlanes

            // Hide world space plane helpers
            planeHelpers.forEach(helper => helper.visible = false);

            // Show relative clipping plane helper based on showPlanes state
            relativeClippingHelper.visible = showPlanesCheckbox.checked;
        } else {
            // Switch back to world space clipping
            relativeControls.classList.remove('active');

            if (heartMesh) {
                const enableClipping = document.getElementById('enableClipping').checked;
                heartMesh.material.clippingPlanes = enableClipping ? clippingPlanes : [];
                heartMesh.material.clipShadows = enableClipping
                heartMesh.material.needsUpdate = true;
            }

            // Floor should not be clipped - do not set clippingPlanes

            // Reset lock
            lockedCameraNormal = null;
            document.getElementById('lockAngle').checked = false;

            // Hide relative clipping plane helper
            relativeClippingHelper.visible = false;

            // Show world space plane helpers based on showPlanes state
            planeHelpers.forEach(helper => {
                helper.visible = showPlanesCheckbox.checked;
            });
        }
    });

    // Relative clipping depth adjustment
    document.getElementById('relativeDepth').addEventListener('input', (event) => {
        const value = parseFloat(event.target.value);
        document.getElementById('relativeDepthValue').textContent = value.toFixed(1);
        relativeClippingDepth = value;
    });

    // Lock cutting plane angle
    document.getElementById('lockAngle').addEventListener('change', (event) => {
        if (event.target.checked) {
            // Lock current camera direction
            const cameraDirection = new THREE.Vector3();
            camera.getWorldDirection(cameraDirection);
            lockedCameraNormal = cameraDirection.negate().clone();
        } else {
            // Unlock
            lockedCameraNormal = null;
        }
    });

    // Auto automatic clipping depth adjustment
    document.getElementById('autoDepth').addEventListener('change', (event) => {
        isAutoDepth = event.target.checked;
        if (!isAutoDepth) {
            // Reset direction when stopping auto adjustment
            autoDepthDirection = 1;
        }
    });

    // Window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function resetView() {
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
}

function resetClipping() {
    ['clipX', 'clipY', 'clipZ'].forEach((id, index) => {
        const slider = document.getElementById(id);
        const valueDisplay = document.getElementById(id + 'Value');
        slider.value = 0;
        valueDisplay.textContent = '0.0';
        clippingPlanes[index].constant = 0;
    });
}

function animate() {
    // Use WebXR-specific setAnimationLoop (supports AR/VR)
    renderer.setAnimationLoop(function() {
        // Calculate FPS
        frameCount++;
        const currentTime = performance.now();
        const deltaTime = currentTime - lastTime;

        if (deltaTime >= 1000) { // Update every second
            fps = Math.round((frameCount * 1000) / deltaTime);
            document.getElementById('fpsCounter').textContent = `FPS: ${fps}`;
            frameCount = 0;
            lastTime = currentTime;
        }

        // Auto automatic clipping depth adjustment
        if (isAutoDepth && isRelativeCameraClipping) {
            relativeClippingDepth += autoDepthSpeed * autoDepthDirection;

            // When reaching boundary, reverse direction
            if (relativeClippingDepth >= 30) {
                relativeClippingDepth = 30;
                autoDepthDirection = -1;
            } else if (relativeClippingDepth <= -30) {
                relativeClippingDepth = -30;
                autoDepthDirection = 1;
            }

            // Update UI
            document.getElementById('relativeDepth').value = relativeClippingDepth;
            document.getElementById('relativeDepthValue').textContent = relativeClippingDepth.toFixed(1);
        }

        // Update relative perspective clipping plane
        if (isRelativeCameraClipping && relativeClippingPlane) {
            if (lockedCameraNormal) {
                // Use locked normal vector
                relativeClippingPlane.normal.copy(lockedCameraNormal);
            } else {
                // Use current camera direction as normal vector
                const cameraDirection = new THREE.Vector3();
                camera.getWorldDirection(cameraDirection);
                relativeClippingPlane.normal.copy(cameraDirection).negate();
            }
            relativeClippingPlane.constant = relativeClippingDepth;
        }

        renderer.render(scene, camera);
    });
}

init();
