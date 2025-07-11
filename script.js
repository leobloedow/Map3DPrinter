// --- Global State ---
let map;
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

// --- NEW: State for map position ---
let isFirstMapLoad = true;
let lastMapState = {
  center: [-30.0346, -51.2177], // Default location
  zoom: 13,
};

// --- Page Navigation ---
function showPage(pageId) {
  document.querySelectorAll(".page").forEach((p) => (p.style.display = "none"));
  document.getElementById(pageId).style.display = "block";
}

function showMapPage() {
  showPage("mapPage");
  setTimeout(() => initializeMap(), 100);
}

function showPreviewPage() {
  showPage("previewPage");
  setTimeout(() => init3DPreview(), 100);
}

function goBackToMain() {
  showPage("mainPage");
  if (map) {
    map.remove();
    map = null;
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

  // Always initialize with the last known state.
  // On first load, this will be the default.
  map = L.map("map").setView(lastMapState.center, lastMapState.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  // Using 'moveend' is slightly more performant than 'move'
  map.on("moveend", updateSelectedBounds);
  map.on("zoomend", updateSelectedBounds);

  // Only try to get user's location on the very first time.
  if (isFirstMapLoad) {
    isFirstMapLoad = false; // Prevent this from running again
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          // This setView will trigger moveend/zoomend, which calls updateSelectedBounds
          // and saves the new state.
          map.setView([pos.coords.latitude, pos.coords.longitude], 17);
        },
        () => {
          // Geolocation failed or denied, just update the bounds display
          // for the default location.
          updateSelectedBounds();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    } else {
      // Geolocation not supported, update bounds for default location.
      updateSelectedBounds();
    }
  } else {
    // If not the first load, we've already set the view from lastMapState.
    // We still need to call updateSelectedBounds once to make sure the
    // overlay and text display are in sync immediately.
    updateSelectedBounds();
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

function updateSelectedBounds() {
  if (!map) return;
  const mapContainer = document.getElementById("map");
  const overlay = document.querySelector(".map-overlay");
  const containerRect = mapContainer.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const topLeftPoint = L.point(
    overlayRect.left - containerRect.left,
    overlayRect.top - containerRect.top
  );
  const bottomRightPoint = L.point(
    overlayRect.right - containerRect.left,
    overlayRect.bottom - containerRect.top
  );
  selectedBounds = {
    topLeft: map.containerPointToLatLng(topLeftPoint),
    bottomRight: map.containerPointToLatLng(bottomRightPoint),
    center: map.getCenter(),
  };

  // Update the last known state
  lastMapState = {
    center: map.getCenter(),
    zoom: map.getZoom(),
  };

  updateLocationDisplay();
}

function updateLocationDisplay() {
  const locationDiv = document.getElementById("selectedLocation");
  if (selectedBounds) {
    const center = selectedBounds.center;
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
  const { topLeft, bottomRight } = selectedBounds;
  const overpassQuery = `
    [out:json][timeout:25];
    (
      way["building"](${bottomRight.lat},${topLeft.lng},${topLeft.lat},${bottomRight.lng});
      relation["building"](${bottomRight.lat},${topLeft.lng},${topLeft.lat},${bottomRight.lng});
      way["highway"](${bottomRight.lat},${topLeft.lng},${topLeft.lat},${bottomRight.lng});
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
      // Check if the error is the one we are handling gracefully
      if (error.message.includes("No features found")) {
        // The user has already been shown a specific message box.
        // We can log this for information, but it's not an unexpected error.
        console.log("Handled case: No features found in the selected area.");
      } else {
        // For other, unexpected errors, log them and inform the user.
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

  const corner1 = latLonToVector3(
    selectedBounds.topLeft.lat,
    selectedBounds.topLeft.lng,
    selectedBounds.center
  );
  const corner2 = latLonToVector3(
    selectedBounds.bottomRight.lat,
    selectedBounds.bottomRight.lng,
    selectedBounds.center
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

  // Scale the model to 20cm and then frame it
  const initialBBox = new THREE.Box3().setFromObject(three.modelGroup);
  const initialSize = initialBBox.getSize(new THREE.Vector3());
  const targetSize = 200;
  const maxInitialDim = Math.max(initialSize.x, initialSize.z);
  const scaleFactor = maxInitialDim > 0 ? targetSize / maxInitialDim : 1;
  three.modelGroup.scale.set(scaleFactor, scaleFactor, scaleFactor);
  three.modelGroup.updateMatrixWorld(true);

  const scaledBBox = new THREE.Box3().setFromObject(three.modelGroup);
  const center = scaledBBox.getCenter(new THREE.Vector3());
  const size = scaledBBox.getSize(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = three.camera.fov * (Math.PI / 180);

  // Calculate the distance required to fit the object in the view
  let cameraDist;
  if (three.camera.aspect < 1) {
    cameraDist = maxDim / 2 / Math.tan(fov / 2) / three.camera.aspect;
  } else {
    cameraDist = maxDim / 2 / Math.tan(fov / 2);
  }

  const padding = 1.3; // Increased padding slightly for a better angled view
  const distance = cameraDist * padding;
  const angle = Math.PI / 4; // 45 degrees

  // Position the camera at an angle
  three.camera.position.set(
    center.x,
    center.y + distance * Math.sin(angle),
    center.z + distance * Math.cos(angle)
  );

  // Look at the center of the model
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
  const center = selectedBounds.center;
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

  // --- ROBUST STL EXPORT ---
  const exportGroup = new THREE.Group();

  // Add base plate, buildings, and roads. Walls are intentionally excluded.
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

  exportGroup.scale.copy(three.modelGroup.scale);
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
