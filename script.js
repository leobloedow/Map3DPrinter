// --- Global State ---
let map;
let selectionRectangle;
let selectedBounds = null;
let geoJsonData = null;
let three = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  animationFrameId: null,
  light: null,
  modelGroup: null,
  basePlate: null,
  wallsGroup: null,
  buildingsGroup: null,
  roadsGroup: null,
};
const originalColors = new Map();

// --- Map State ---
let isFirstMapLoad = true;
let lastMapState = {
  center: [-30.0346, -51.2177], // Default to Porto Alegre
  zoom: 13,
};
const SELECTION_SIZES = {
  // In degrees latitude
  small: 0.005, // ~550m
  medium: 0.015, // ~1.6km (was 2.2km)
  large: 0.035, // ~3.8km (smaller than before)
};

// CM size options for each map size
const CM_SIZE_OPTIONS = {
  small: [5, 10], // P size supports 5x5cm and 10x10cm
  medium: [10, 20], // M size supports 10x10 and 20x20cm
  large: [20], // G size supports only 20x20cm
};

let currentSelectionSize = "medium";
let currentCmSize = 10; // Default cm size

// --- Page Navigation ---
function showPage(pageId) {
  document.querySelectorAll(".page").forEach((p) => (p.style.display = "none"));
  document.getElementById(pageId).style.display = "block";
}

function showMapPage() {
  showPage("mapPage");
  setTimeout(() => {
    initializeMap();
  }, 100);
}

function showPreviewPage() {
  showPage("previewPage");
  setTimeout(() => {
    setupCmSizeSelector();
    init3DPreview();
  }, 100);
}

function setupCmSizeSelector() {
  const container = document.getElementById("cmSizeOptions");
  if (!container) return;
  
  container.innerHTML = "";
  
  const availableSizes = CM_SIZE_OPTIONS[currentSelectionSize];
  
  availableSizes.forEach(size => {
    const button = document.createElement("button");
    button.className = "cm-option";
    button.textContent = `${size}x${size}`;
    button.dataset.size = size;
    button.title = `${size}x${size} cm`;
    
    if (size === currentCmSize) {
      button.classList.add("active");
    }
    
    button.addEventListener("click", () => {
      currentCmSize = size;
      document.querySelectorAll(".cm-option").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      // No need to update 3D preview - it stays at fixed scale for visualization
    });
    
    container.appendChild(button);
  });
}

function changeCmSize(size) {
  currentCmSize = size;
  setupCmSizeSelector();
  // No need to update 3D preview - it stays at fixed scale for visualization
}

function goBackToMain() {
  showPage("mainPage");
  if (map) {
    map.remove();
    map = null;
    selectionRectangle = null;
  }
}

function goBackToMap() {
  showPage("mapPage");
  destroy3DPreview();
  setTimeout(() => initializeMap(), 100);
}

// --- Message & Loading ---
function showMessageBox(title, message) {
  document.getElementById("messageBoxTitle").textContent = title;
  document.getElementById("messageBoxText").textContent = message;
  document.getElementById("messageBoxOverlay").style.display = "flex";
}

function hideMessageBox() {
  document.getElementById("messageBoxOverlay").style.display = "none";
}

function promptForCoordinates() {
  document.getElementById("coordInputOverlay").style.display = "flex";
}

function hideCoordInput() {
  document.getElementById("coordInputOverlay").style.display = "none";
}

function submitCoordinates() {
  const input = document.getElementById("coordInput").value;
  const parts = input.split(",").map((part) => part.trim());
  if (parts.length !== 2) {
    hideCoordInput();
    return showMessageBox(
      "Erro de Formato",
      "Por favor, insira a latitude e a longitude separadas por uma vírgula."
    );
  }
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);

  if (
    isNaN(lat) ||
    isNaN(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    hideCoordInput();
    return showMessageBox(
      "Coordenadas Inválidas",
      "Por favor, insira valores válidos para latitude (-90 a 90) e longitude (-180 a 180)."
    );
  }

  map.setView([lat, lon], map.getZoom() || 17);
  hideCoordInput();
}

function showLoader(show, text = "Carregando...") {
  document.getElementById("loadingText").textContent = text;
  document.getElementById("loadingOverlay").style.display = show
    ? "flex"
    : "none";
}

// --- Map Logic (Leaflet) ---
function initializeMap() {
  if (map) map.remove();

  map = L.map("map", {
    center: lastMapState.center,
    zoom: lastMapState.zoom,
    zoomControl: false,
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  // Add event listeners
  map.on("move", updateSelectionArea);
  map.on("zoomend", updateSelectionArea);
  map.on("load", updateSelectionArea); // Handles initial load and setView

  // Setup custom size selector buttons
  document.querySelectorAll(".size-option").forEach((button) => {
    button.addEventListener("click", () => {
      currentSelectionSize = button.dataset.size;
      document
        .querySelectorAll(".size-option")
        .forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      
      // Update cm size to first available option for new map size
      const availableSizes = CM_SIZE_OPTIONS[currentSelectionSize];
      if (availableSizes && availableSizes.length > 0) {
        currentCmSize = availableSizes[0];
      }

      updateSelectionArea();
    });
  });

  if (isFirstMapLoad) {
    isFirstMapLoad = false;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.setView([pos.coords.latitude, pos.coords.longitude], 17);
        },
        () => {
          updateSelectionArea();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    } else {
      updateSelectionArea();
    }
  } else {
    updateSelectionArea();
  }
}

function searchLocation() {
  const query = document.getElementById("mapSearchInput").value;
  if (!query) return;

  showLoader(true, "Buscando local...");
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    query
  )}`;

  fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error("A busca de endereço falhou.");
      return response.json();
    })
    .then((data) => {
      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        map.setView([lat, lon], 17);
      } else {
        showMessageBox(
          "Local não Encontrado",
          "Não foi possível encontrar o endereço. Tente uma busca diferente."
        );
      }
    })
    .catch((error) => {
      console.error("Erro na busca:", error);
      showMessageBox("Erro na Busca", "Ocorreu um erro ao buscar o endereço.");
    })
    .finally(() => showLoader(false));
}

function updateSelectionArea() {
  if (!map) return;

  const center = map.getCenter();
  const latDelta = SELECTION_SIZES[currentSelectionSize];
  const halfLatDelta = latDelta / 2;

  const aspectRatio = Math.cos((center.lat * Math.PI) / 180);
  const lonDelta = latDelta / aspectRatio;
  const halfLonDelta = lonDelta / 2;

  const bounds = L.latLngBounds(
    [center.lat - halfLatDelta, center.lng - halfLonDelta],
    [center.lat + halfLatDelta, center.lng + halfLonDelta]
  );

  if (selectionRectangle) {
    selectionRectangle.setBounds(bounds);
  } else {
    selectionRectangle = L.rectangle(bounds, {
      color: "#8000ff",
      weight: 3,
      fillColor: "#4444ff",
      fillOpacity: 0.1,
      interactive: false,
    }).addTo(map);
  }

  selectedBounds = selectionRectangle.getBounds();
  lastMapState = {
    center: center,
    zoom: map.getZoom(),
  };

  updateLocationDisplay();
  updateSelectorPosition();
}

function updateSelectorPosition() {
  if (!map || !selectionRectangle) return;

  const selector = document.getElementById("sizeSelectorContainer");
  const mapContainer = document.getElementById("map");
  const mapRect = mapContainer.getBoundingClientRect();

  const south = selectedBounds.getSouth();
  const center = selectedBounds.getCenter();
  const bottomPoint = map.latLngToContainerPoint([south, center.lng]);

  let topPos = bottomPoint.y + 15;

  const selectorHeight = selector.offsetHeight;
  if (topPos + selectorHeight > mapRect.height) {
    topPos = mapRect.height - selectorHeight - 15;
  }

  selector.style.top = `${topPos}px`;
  selector.style.left = `${bottomPoint.x}px`;
}

function updateLocationDisplay() {
  const locationDiv = document.getElementById("selectedLocation");
  if (selectedBounds) {
    const center = selectedBounds.getCenter();
    locationDiv.textContent = `${center.lat.toFixed(4)}, ${center.lng.toFixed(
      4
    )}`;
  }
}

function confirmLocation() {
  if (!selectedBounds) return;
  const confirmButton = document.getElementById("confirmButton");
  showLoader(true, "construindo o modelo 3D...");
  confirmButton.disabled = true;
  confirmButton.textContent = "carregando...";

  const northEast = selectedBounds.getNorthEast();
  const southWest = selectedBounds.getSouthWest();

  const overpassQuery = `
    [out:json][timeout:25];
    (
      way["building"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
      relation["building"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
      way["highway"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    );
    out geom;
  `;
  fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(overpassQuery)}`,
  })
    .then((response) => {
      if (!response.ok)
        throw new Error(`Erro na API Overpass: ${response.status}`);
      return response.json();
    })
    .then((data) => {
      geoJsonData = osmtogeojson(data);

      // BUG FIX: Check for incomplete data
      const areaSize = SELECTION_SIZES[currentSelectionSize];
      if (geoJsonData.features.length < 5 && areaSize > 0.01) {
        showMessageBox(
          "Dados Incompletos?",
          "Foram encontrados poucos detalhes na área selecionada. O mapa pode não ter carregado completamente. Tente mover o mapa, aguarde os detalhes aparecerem e confirme novamente."
        );
        throw new Error("Potentially incomplete data");
      }

      if (geoJsonData.features.length === 0) {
        showMessageBox(
          "Nenhum Dado Encontrado",
          "Não foram encontrados edifícios ou ruas na área selecionada. Por favor, tente uma localização diferente."
        );
        throw new Error("No features found");
      }
      showPreviewPage();
    })
    .catch((error) => {
      if (
        error.message.includes("No features found") ||
        error.message.includes("Potentially incomplete data")
      ) {
        console.log(`Handled case: ${error.message}`);
      } else {
        console.error("Erro ao buscar dados:", error);
        showMessageBox("Erro", `Falha ao buscar dados: ${error.message}.`);
      }
    })
    .finally(() => {
      showLoader(false);
      confirmButton.disabled = false;
      confirmButton.textContent = "confirmar localização";
    });
}

// --- 3D Preview Logic (Three.js) ---
function init3DPreview() {
  if (!geoJsonData || three.renderer) return;
  const container = document.getElementById("previewContainer");

  const header = document.querySelector("#previewPage .page-header");
  if (header) {
    container.style.top = `${header.offsetHeight}px`;
  }

  three.scene = new THREE.Scene();
  three.scene.background = new THREE.Color(0xddeeff);
  const aspect = container.clientWidth / container.clientHeight;
  three.camera = new THREE.PerspectiveCamera(50, aspect, 1, 10000);

  three.modelGroup = new THREE.Group();
  three.wallsGroup = new THREE.Group();
  three.buildingsGroup = new THREE.Group();
  three.roadsGroup = new THREE.Group();
  three.modelGroup.add(
    three.wallsGroup,
    three.buildingsGroup,
    three.roadsGroup
  );
  three.scene.add(three.modelGroup);

  const centerLatLng = selectedBounds.getCenter();
  const corner1 = latLonToVector3(
    selectedBounds.getNorthWest().lat,
    selectedBounds.getNorthWest().lng,
    centerLatLng
  );
  const corner2 = latLonToVector3(
    selectedBounds.getSouthEast().lat,
    selectedBounds.getSouthEast().lng,
    centerLatLng
  );
  const worldWidth = Math.abs(corner1.x - corner2.x);
  const worldDepth = Math.abs(corner1.z - corner2.z);

  three.renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  three.renderer.setSize(container.clientWidth, container.clientHeight);
  three.renderer.setPixelRatio(window.devicePixelRatio);
  three.renderer.shadowMap.enabled = true;
  three.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(three.renderer.domElement);

  three.controls = new THREE.OrbitControls(
    three.camera,
    three.renderer.domElement
  );
  three.controls.enableDamping = true;
  three.controls.dampingFactor = 0.1;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  three.scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
  directionalLight.position.set(50, 80, 50);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 16384;
  directionalLight.shadow.mapSize.height = 16384;
  const shadowCamSize = Math.max(worldWidth, worldDepth) * 1.5;
  directionalLight.shadow.camera.left = -shadowCamSize;
  directionalLight.shadow.camera.right = shadowCamSize;
  directionalLight.shadow.camera.top = shadowCamSize;
  directionalLight.shadow.camera.bottom = -shadowCamSize;
  directionalLight.shadow.camera.near = 10;
  directionalLight.shadow.camera.far = 2000;
  directionalLight.shadow.bias = -0.001;
  three.light = directionalLight;
  three.camera.add(three.light);
  three.camera.add(three.light.target);
  three.scene.add(three.camera);

  const clipBounds = {
    minX: -worldWidth / 2,
    maxX: worldWidth / 2,
    minZ: -worldDepth / 2,
    maxZ: worldDepth / 2,
  };
  const plateThickness = 5;

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
  });
  three.basePlate = new THREE.Mesh(
    new THREE.BoxGeometry(worldWidth, plateThickness, worldDepth),
    baseMaterial
  );
  three.basePlate.position.y = 0;
  three.basePlate.receiveShadow = true;
  three.modelGroup.add(three.basePlate);
  originalColors.set(three.basePlate, three.basePlate.material.color.getHex());

  const maxHeight = drawFeatures(clipBounds, plateThickness);
  createWalls(worldWidth, worldDepth, maxHeight, plateThickness, 3);

  const initialBBox = new THREE.Box3().setFromObject(three.modelGroup);
  const initialSize = initialBBox.getSize(new THREE.Vector3());
  const targetSize = 200; // Fixed preview size for consistent visualization
  const maxInitialDim = Math.max(initialSize.x, initialSize.z);
  const scaleFactor = maxInitialDim > 0 ? targetSize / maxInitialDim : 1;
  three.modelGroup.scale.set(scaleFactor, scaleFactor, scaleFactor);
  three.modelGroup.updateMatrixWorld(true);

  const scaledBBox = new THREE.Box3().setFromObject(three.modelGroup);
  const center = scaledBBox.getCenter(new THREE.Vector3());
  const size = scaledBBox.getSize(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = three.camera.fov * (Math.PI / 180);

  let cameraDist;
  if (three.camera.aspect < 1) {
    cameraDist = maxDim / 2 / Math.tan(fov / 2) / three.camera.aspect;
  } else {
    cameraDist = maxDim / 2 / Math.tan(fov / 2);
  }

  const padding = 1.3;
  const distance = cameraDist * padding;
  const angle = Math.PI / 4;

  three.camera.position.set(
    center.x,
    center.y + distance * Math.sin(angle),
    center.z + distance * Math.cos(angle)
  );

  three.camera.lookAt(center);
  three.controls.target.copy(center);
  three.controls.update();

  window.addEventListener("resize", onWindowResize);
  animate3D();
}

function destroy3DPreview() {
  if (three.animationFrameId) cancelAnimationFrame(three.animationFrameId);
  if (three.renderer) {
    three.renderer.domElement.remove();
    three.renderer.dispose();
  }
  window.removeEventListener("resize", onWindowResize);
  three = {
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    light: null,
    animationFrameId: null,
    modelGroup: null,
    basePlate: null,
    wallsGroup: null,
    buildingsGroup: null,
    roadsGroup: null,
  };
  geoJsonData = null;
  originalColors.clear();
  selectionRectangle = null;
}

function onWindowResize() {
  const container = document.getElementById("previewContainer");
  if (!three.renderer || !container) return;

  const header = document.querySelector("#previewPage .page-header");
  if (header) {
    container.style.top = `${header.offsetHeight}px`;
  }

  three.camera.aspect = container.clientWidth / container.clientHeight;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate3D() {
  three.animationFrameId = requestAnimationFrame(animate3D);
  three.controls.update();
  if (three.light) {
    three.light.target.position.copy(three.controls.target);
  }
  three.renderer.render(three.scene, three.camera);
}

function latLonToVector3(lat, lon, center) {
  const R = 6371e3;
  const phi = (lat * Math.PI) / 180;
  const centerPhi = (center.lat * Math.PI) / 180;
  const deltaLambda = ((lon - center.lng) * Math.PI) / 180;
  const x = R * deltaLambda * Math.cos(centerPhi);
  const z = R * (phi - centerPhi);
  return new THREE.Vector3(x, 0, -z);
}

function createWalls(
  width,
  depth,
  contentHeight,
  plateThickness,
  wallThickness
) {
  const wallHeight = contentHeight + plateThickness;
  const wallYPosition = contentHeight / 2;
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
  });

  const frontWall = new THREE.Mesh(
    new THREE.BoxGeometry(width + wallThickness * 2, wallHeight, wallThickness),
    wallMaterial.clone()
  );
  frontWall.position.set(0, wallYPosition, depth / 2 + wallThickness / 2);
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(width + wallThickness * 2, wallHeight, wallThickness),
    wallMaterial.clone()
  );
  backWall.position.set(0, wallYPosition, -(depth / 2) - wallThickness / 2);
  const leftWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, depth),
    wallMaterial.clone()
  );
  leftWall.position.set(-(width / 2) - wallThickness / 2, wallYPosition, 0);
  const rightWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, depth),
    wallMaterial.clone()
  );
  rightWall.position.set(width / 2 + wallThickness / 2, wallYPosition, 0);

  [frontWall, backWall, leftWall, rightWall].forEach((wall) => {
    wall.castShadow = true;
    wall.receiveShadow = true;
    three.wallsGroup.add(wall);
    originalColors.set(wall, wall.material.color.getHex());
  });
}

function drawFeatures(clipBounds, plateThickness) {
  const center = selectedBounds.getCenter();
  let maxHeight = 0;
  const buildingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const streetMaterial = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
  });

  geoJsonData.features.forEach((feature) => {
    if (feature.geometry) {
      if (feature.properties.building) {
        const material = buildingMaterial.clone();
        const processFunc = (coords) => {
          const { mesh, height } = processPolygon(
            coords,
            feature.properties,
            center,
            material,
            clipBounds,
            plateThickness
          );
          if (mesh) maxHeight = Math.max(maxHeight, height);
        };
        if (feature.geometry.type === "Polygon")
          processFunc(feature.geometry.coordinates);
        else if (feature.geometry.type === "MultiPolygon")
          feature.geometry.coordinates.forEach(processFunc);
      } else if (
        feature.properties.highway &&
        feature.geometry.type === "LineString"
      ) {
        processLineString(
          feature.geometry.coordinates,
          center,
          streetMaterial.clone(),
          clipBounds,
          plateThickness
        );
      }
    }
  });
  return maxHeight;
}

function cleanShapePoints(points, tolerance = 0.1) {
  if (points.length < 2) return points;
  const cleaned = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceTo(cleaned[cleaned.length - 1]) > tolerance) {
      cleaned.push(points[i]);
    }
  }
  if (
    cleaned.length > 1 &&
    cleaned[0].distanceTo(cleaned[cleaned.length - 1]) < tolerance
  ) {
    cleaned.pop();
  }
  return cleaned;
}

function processPolygon(
  polygonCoords,
  properties,
  center,
  material,
  clipBounds,
  plateThickness
) {
  const outerRing = polygonCoords[0].map((p) => {
    const vec = latLonToVector3(p[1], p[0], center);
    return new THREE.Vector2(vec.x, -vec.z);
  });

  let clippedOuterRing = clipPolygon(
    outerRing,
    clipBounds.minX,
    clipBounds.maxX,
    clipBounds.minZ,
    clipBounds.maxZ
  );
  clippedOuterRing = cleanShapePoints(clippedOuterRing);

  if (clippedOuterRing.length < 3) return { mesh: null, height: 0 };

  const shape = new THREE.Shape(clippedOuterRing);

  for (let i = 1; i < polygonCoords.length; i++) {
    const holeRing = polygonCoords[i].map((p) => {
      const vec = latLonToVector3(p[1], p[0], center);
      return new THREE.Vector2(vec.x, -vec.z);
    });
    let clippedHoleRing = clipPolygon(
      holeRing,
      clipBounds.minX,
      clipBounds.maxX,
      clipBounds.minZ,
      clipBounds.maxZ
    );
    clippedHoleRing = cleanShapePoints(clippedHoleRing);
    if (clippedHoleRing.length >= 3) {
      const holePath = new THREE.Path(clippedHoleRing);
      shape.holes.push(holePath);
    }
  }

  const MIN_BUILDING_HEIGHT = 12,
    MAX_BUILDING_HEIGHT = 25;
  let height = properties["building:levels"]
    ? properties["building:levels"] * 3.5
    : parseFloat(properties.height) || 15;
  height = Math.max(MIN_BUILDING_HEIGHT, Math.min(height, MAX_BUILDING_HEIGHT));

  const extrudeSettings = {
    steps: 1,
    depth: height,
    bevelEnabled: false,
  };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = plateThickness / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  three.buildingsGroup.add(mesh);
  originalColors.set(mesh, mesh.material.color.getHex());
  return { mesh, height };
}

function processLineString(
  lineCoords,
  center,
  material,
  clipBounds,
  plateThickness
) {
  const points = lineCoords.map((p) => latLonToVector3(p[1], p[0], center));
  if (points.length < 2) return;

  const clippedSegments = clipPolyline(
    points,
    clipBounds.minX,
    clipBounds.maxX,
    clipBounds.minZ,
    clipBounds.maxZ
  );
  if (clippedSegments.length === 0) return;

  const streetWidth = 6,
    streetHeight = 2.0;
  clippedSegments.forEach((segmentPoints) => {
    if (segmentPoints.length < 2) return;
    for (let i = 0; i < segmentPoints.length - 1; i++) {
      const p1 = segmentPoints[i];
      const p2 = segmentPoints[i + 1];
      const length = p1.distanceTo(p2);
      if (length < 0.1) continue;

      const roadSegment = new THREE.Mesh(
        new THREE.BoxGeometry(streetWidth, streetHeight, length),
        material
      );
      roadSegment.position.copy(p1).lerp(p2, 0.5);
      roadSegment.position.y = plateThickness / 2 + streetHeight / 2;
      roadSegment.lookAt(p2.x, roadSegment.position.y, p2.z);
      roadSegment.castShadow = true;
      roadSegment.receiveShadow = true;
      three.roadsGroup.add(roadSegment);
      originalColors.set(roadSegment, roadSegment.material.color.getHex());
    }
  });
}

function clipPolygon(subjectPolygon, minX, maxX, minY, maxY) {
  let outputList = subjectPolygon;
  const clipEdges = [
    { axis: "y", val: minY, dir: -1 },
    { axis: "x", val: maxX, dir: 1 },
    { axis: "y", val: maxY, dir: 1 },
    { axis: "x", val: minX, dir: -1 },
  ];
  for (const edge of clipEdges) {
    const inputList = outputList;
    outputList = [];
    if (inputList.length === 0) break;
    let S = inputList[inputList.length - 1];
    for (let i = 0; i < inputList.length; i++) {
      let E = inputList[i];
      const s_inside = S[edge.axis] * edge.dir <= edge.val * edge.dir;
      const e_inside = E[edge.axis] * edge.dir <= edge.val * edge.dir;
      if (e_inside) {
        if (!s_inside) outputList.push(getIntersection(S, E, edge));
        outputList.push(E);
      } else if (s_inside) {
        outputList.push(getIntersection(S, E, edge));
      }
      S = E;
    }
  }
  return outputList;
  function getIntersection(S, E, edge) {
    const dx = E.x - S.x,
      dy = E.y - S.y;
    const t = edge.axis === "x" ? (edge.val - S.x) / dx : (edge.val - S.y) / dy;
    return new THREE.Vector2(S.x + t * dx, S.y + t * dy);
  }
}

function clipPolyline(polyline, minX, maxX, minZ, maxZ) {
  const INSIDE = 0,
    LEFT = 1,
    RIGHT = 2,
    BOTTOM = 4,
    TOP = 8;
  const computeOutCode = (p) => {
    let code = INSIDE;
    if (p.x < minX) code |= LEFT;
    else if (p.x > maxX) code |= RIGHT;
    if (p.z < minZ) code |= BOTTOM;
    else if (p.z > maxZ) code |= TOP;
    return code;
  };
  const clippedPolylines = [];
  let currentSegment = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    let p1 = polyline[i].clone(),
      p2 = polyline[i + 1].clone();
    let outcode1 = computeOutCode(p1),
      outcode2 = computeOutCode(p2);
    let accept = false;
    while (true) {
      if (!(outcode1 | outcode2)) {
        accept = true;
        break;
      } else if (outcode1 & outcode2) {
        break;
      } else {
        let x, z;
        const outcodeOut = outcode1 || outcode2;
        if (outcodeOut & TOP) {
          x = p1.x + ((p2.x - p1.x) * (maxZ - p1.z)) / (p2.z - p1.z);
          z = maxZ;
        } else if (outcodeOut & BOTTOM) {
          x = p1.x + ((p2.x - p1.x) * (minZ - p1.z)) / (p2.z - p1.z);
          z = minZ;
        } else if (outcodeOut & RIGHT) {
          z = p1.z + ((p2.z - p1.z) * (maxX - p1.x)) / (p2.x - p1.x);
          x = maxX;
        } else if (outcodeOut & LEFT) {
          z = p1.z + ((p2.z - p1.z) * (minX - p1.x)) / (p2.x - p1.x);
          x = minX;
        }
        if (outcodeOut === outcode1) {
          p1.x = x;
          p1.z = z;
          outcode1 = computeOutCode(p1);
        } else {
          p2.x = x;
          p2.z = z;
          outcode2 = computeOutCode(p2);
        }
      }
    }
    if (accept) {
      if (
        currentSegment.length > 0 &&
        !currentSegment[currentSegment.length - 1].equals(p1)
      ) {
        clippedPolylines.push(currentSegment);
        currentSegment = [];
      }
      if (currentSegment.length === 0) currentSegment.push(p1);
      currentSegment.push(p2);
    } else {
      if (currentSegment.length > 0) {
        clippedPolylines.push(currentSegment);
        currentSegment = [];
      }
    }
  }
  if (currentSegment.length > 0) clippedPolylines.push(currentSegment);
  return clippedPolylines;
}

// --- Feature Functions ---
function downloadSTL() {
  if (!three.modelGroup) {
    return showMessageBox("Erro", "A cena 3D não foi carregada.");
  }

  // Clone the original, unscaled geometry for export
  const exportGroup = new THREE.Group();

  if (three.basePlate) {
    exportGroup.add(three.basePlate.clone());
  }
  if (three.buildingsGroup) {
    const buildingsClone = three.buildingsGroup.clone(true);
    buildingsClone.userData.isBuildings = true;
    exportGroup.add(buildingsClone);
  }
  if (three.roadsGroup) {
    const roadsClone = three.roadsGroup.clone(true);
    roadsClone.userData.isRoads = true;
    exportGroup.add(roadsClone);
  }

  // Remove any scaling from the preview
  exportGroup.scale.set(1, 1, 1);
  exportGroup.updateMatrixWorld(true, true);

  // Calculate the bounding box of the unscaled export group
  const bbox = new THREE.Box3().setFromObject(exportGroup);
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.z);
  const targetSizeMm = currentCmSize * 10; // cm to mm
  const exportScaleFactor = maxDim > 0 ? targetSizeMm / maxDim : 1;

  // Apply the correct scale for export
  exportGroup.scale.set(exportScaleFactor, exportScaleFactor, exportScaleFactor);
  exportGroup.updateMatrixWorld(true, true);

  const geometriesToMerge = [];
  const sinkAmount = 0.1;

  exportGroup.traverse((object) => {
    if (object.isMesh) {
      let needsSink = false;
      if (
        object.parent &&
        (object.parent.userData.isBuildings || object.parent.userData.isRoads)
      ) {
        needsSink = true;
      }

      const geom = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();

      geom.applyMatrix4(object.matrixWorld);

      if (needsSink) {
        const sinkMatrix = new THREE.Matrix4().makeTranslation(
          0,
          -sinkAmount,
          0
        );
        geom.applyMatrix4(sinkMatrix);
      }

      geometriesToMerge.push(geom);
    }
  });

  if (geometriesToMerge.length === 0) {
    return showMessageBox(
      "Nada para exportar",
      "Nenhuma parte do modelo está visível."
    );
  }

  const mergedGeometry = THREE.BufferGeometryUtils.mergeBufferGeometries(
    geometriesToMerge,
    false
  );
  if (!mergedGeometry) {
    return showMessageBox("Erro", "Falha ao mesclar a geometria do modelo.");
  }

  mergedGeometry.rotateX(-Math.PI / 2);
  mergedGeometry.rotateX(Math.PI);
  mergedGeometry.computeBoundingBox();
  const center = new THREE.Vector3();
  mergedGeometry.boundingBox.getCenter(center);
  mergedGeometry.translate(-center.x, -center.y, -center.z);

  const finalMesh = new THREE.Mesh(mergedGeometry);

  const exporter = new THREE.STLExporter();
  const result = exporter.parse(finalMesh, { binary: true });
  const blob = new Blob([result], { type: "application/octet-stream" });

  const link = document.createElement("a");
  link.style.display = "none";
  document.body.appendChild(link);
  link.href = URL.createObjectURL(blob);
  link.download = "MAP.stl";
  link.click();
  URL.revokeObjectURL(link.href);
  document.body.removeChild(link);
}

function changeModelColor(color) {
  if (!three.modelGroup) return;
  three.modelGroup.traverse((object) => {
    if (object.isMesh) {
      if (!originalColors.has(object)) {
        originalColors.set(object, object.material.color.getHex());
      }
      object.material.color.set(color);
    }
  });
}

function resetModelColor() {
  if (!three.modelGroup) return;
  three.modelGroup.traverse((object) => {
    if (object.isMesh && originalColors.has(object)) {
      object.material.color.setHex(originalColors.get(object));
    }
  });
}

// Initial setup
window.onload = () => showPage("mainPage");
