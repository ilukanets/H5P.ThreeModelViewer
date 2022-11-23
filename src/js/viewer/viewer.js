import {
  AmbientLight,
  AnimationMixer,
  AxesHelper,
  Box3,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  LinearEncoding,
  LinearToneMapping,
  LoaderUtils,
  LoadingManager,
  PerspectiveCamera,
  PMREMGenerator,
  REVISION,
  Scene, SkeletonHelper,
  sRGBEncoding,
  Vector3,
  WebGLRenderer
} from 'three';
import { environments } from '../../assets/environment';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module';
import { TWEEN } from 'three/examples/jsm/libs/tween.module.min.js';

import { createBackground } from '../lib/three-vignette';

const MANAGER = new LoadingManager();
const THREE_PATH = `https://unpkg.com/three@0.${REVISION}.x`;
const DRACO_LOADER = new DRACOLoader(MANAGER).setDecoderPath(`${THREE_PATH}/examples/js/libs/draco/gltf/`);
const KTX2_LOADER = new KTX2Loader(MANAGER).setTranscoderPath(`${THREE_PATH}/examples/js/libs/basis/`);

const DEFAULT_CAMERA = '[default]';
const IS_IOS = isIOS();
const ZOOM_FACTOR = 1.2;

const Preset = { ASSET_GENERATOR: 'assetgenerator' };

export class Viewer {
  constructor(el, options) {
    this.el = el;
    this.options = options;

    this.lights = [];
    this.content = null;
    this.mixer = null;
    this.clips = [];

    this.isFullscreen = false;

    // @todo: Sanitize state object.
    this.state = {
      environment: options.preset === Preset.ASSET_GENERATOR
          ? environments.find((e) => e.id === 'footprint-court').name
          : environments[1].name,
      background: false,
      playbackSpeed: 1.0,
      actionStates: {},
      camera: DEFAULT_CAMERA,
      wireframe: false,
      skeleton: false,
      grid: options.grid || false,

      // Lights
      punctualLights: true,
      exposure: 0.0,
      toneMapping: LinearToneMapping,
      textureEncoding: 'sRGB',
      ambientIntensity: 0.3,
      ambientColor: 0xFFFFFF,
      directIntensity: 0.8 * Math.PI,
      directColor: 0xFFFFFF,
      bgColor: options.bgColor ?? 0xFFFFFF,
      bgColor1: options.bgColor1 ?? '#FFFFFF',
      bgColor2: options.bgColor2 ?? '#F6F5F5',
    };

    // Create Scene.
    this.scene = new Scene();

    // Create camera.
    const fov = options.preset === Preset.ASSET_GENERATOR
        ? 0.8 * 180 / Math.PI
        : 60;
    this.defaultCamera = new PerspectiveCamera(fov, el.clientWidth / el.clientHeight, 0.01, 1000);
    this.activeCamera = this.defaultCamera;

    this.scene.add(this.defaultCamera);

    // Create renderer.
    this.renderer = window.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.physicallyCorrectLights = true;
    this.renderer.outputEncoding = sRGBEncoding;
    this.renderer.setClearColor(this.state.bgColor);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(el.clientWidth, el.clientHeight);

    this.pmremGenerator = new PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();

    this.neutralEnvironment = this.pmremGenerator.fromScene(new RoomEnvironment()).texture;

    this.controls = new OrbitControls(this.defaultCamera, this.renderer.domElement);
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = -10;
    this.controls.screenSpacePanning = true;

    if (this.options.vignette) {
      this.vignette = createBackground({
        aspect: this.defaultCamera.aspect,
        grainScale: IS_IOS ? 0 : 0.001, // mattdesl/three-vignette-background#1
        colors: [this.state.bgColor1, this.state.bgColor2]
      });
      this.vignette.name = 'Vignette';
      this.vignette.renderOrder = -1;
    }

    this.el.appendChild(this.renderer.domElement);

    // @todo: Controls GUI
    // this.cameraCtrl = null;
    // this.cameraFolder = null;
    // this.animFolder = null;
    // this.animCtrls = [];
    // this.morphFolder = null;
    // this.morphCtrls = [];

    this.skeletonHelpers = [];
    this.gridHelper = null;
    this.axesHelper = null;

    this.addAxesHelper();
    this.addGUI();

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    window.addEventListener('resize', this.resize.bind(this), false);
  }

  animate(time) {
    requestAnimationFrame(this.animate);

    const dt = (time - this.prevTime) / 1000;

    this.controls.update();

    TWEEN.update();
    this.mixer && this.mixer.update(dt);

    this.render();

    this.prevTime = time;
  }

  render() {
    this.renderer.render(this.scene, this.activeCamera);

    if (this.state.grid) {
      this.axesCamera.position.copy(this.defaultCamera.position)
      this.axesCamera.lookAt(this.axesScene.position)
      this.axesRenderer.render(this.axesScene, this.axesCamera);
    }
  }

  resize() {
    let { clientHeight, clientWidth } = !this.isFullscreen ? this.el.parentElement : document.documentElement;

    this.defaultCamera.aspect = clientWidth / clientHeight;
    this.defaultCamera.updateProjectionMatrix();
    this.vignette && this.vignette.style({ aspect: this.defaultCamera.aspect });
    this.renderer.setSize(clientWidth, clientHeight);

    this.axesCamera.aspect = this.axesDiv.clientWidth / this.axesDiv.clientHeight;
    this.axesCamera.updateProjectionMatrix();
    this.axesRenderer.setSize(this.axesDiv.clientWidth, this.axesDiv.clientHeight);
  }

  load(url, rootPath, assetMap) {
    const baseURL = LoaderUtils.extractUrlBase(url);

    // Load.
    return new Promise((resolve, reject) => {
      // Intercept and override relative URLs.
      MANAGER.setURLModifier((url, path) => {

        // URIs in a glTF file may be escaped, or not. Assume that assetMap is
        // from an un-escaped source, and decode all URIs before lookups.
        // See: https://github.com/donmccurdy/three-gltf-viewer/issues/146
        const normalizedURL = rootPath + decodeURI(url)
            .replace(baseURL, '')
            .replace(/^(\.?\/)/, '');

        if (assetMap.has(normalizedURL)) {
          const blob = assetMap.get(normalizedURL);
          const blobURL = URL.createObjectURL(blob);
          blobURLs.push(blobURL);
          return blobURL;
        }

        return (path || '') + url;

      });

      const loader = new GLTFLoader(MANAGER)
          .setCrossOrigin('anonymous')
          .setDRACOLoader(DRACO_LOADER)
          .setKTX2Loader(KTX2_LOADER.detectSupport(this.renderer))
          .setMeshoptDecoder(MeshoptDecoder);

      const blobURLs = [];

      loader.load(url, (gltf) => {
        window.VIEWER.json = gltf;

        const scene = gltf.scene || gltf.scenes[0];
        const clips = gltf.animations || [];

        if (!scene) {
          // Valid, but not supported by this viewer.
          throw new Error(
              'This model contains no scene, and cannot be viewed here. However,'
              + ' it may contain individual 3D resources.'
          );
        }

        this.setContent(scene, clips);

        blobURLs.forEach(URL.revokeObjectURL);

        // See: https://github.com/google/draco/issues/349
        // DRACOLoader.releaseDecoderModule();

        resolve(gltf);

      }, undefined, reject);

    });

  }

  /**
   * @param {THREE.Object3D} object
   * @param {Array<THREE.AnimationClip} clips
   */
  setContent(object, clips) {
    this.clear();

    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3()).length();
    const center = box.getCenter(new Vector3());

    this.controls.reset();

    object.position.x += (object.position.x - center.x);
    object.position.y += (object.position.y - center.y);
    object.position.z += (object.position.z - center.z);

    this.controls.maxDistance = size * 10;
    this.defaultCamera.near = size / 100;
    this.defaultCamera.far = size * 100;
    this.defaultCamera.updateProjectionMatrix();

    if (this.options.cameraPosition) {
      this.defaultCamera.position.fromArray(this.options.cameraPosition);
      this.defaultCamera.lookAt(new Vector3());
    } else {
      this.defaultCamera.position.copy(center);
      this.defaultCamera.position.x += size / 2.0;
      this.defaultCamera.position.y += size / 3.0;
      this.defaultCamera.position.z += size / 2.0;
      this.defaultCamera.lookAt(center);
    }

    // Save camera start position.
    this.activeCameraPosition = new Vector3().copy(this.defaultCamera.position);

    this.setCamera(DEFAULT_CAMERA);

    this.axesCamera.position.copy(this.defaultCamera.position);
    this.axesCamera.lookAt(this.axesScene.position);
    this.axesCamera.near = size / 100;
    this.axesCamera.far = size * 100;
    this.axesCamera.updateProjectionMatrix();
    this.axesCorner.scale.set(size, size, size);

    this.controls.saveState();

    this.scene.add(object);
    this.content = object;

    this.state.punctualLights = true;

    this.content.traverse((node) => {
      if (node.isLight) {
        this.state.punctualLights = false;
      } else if (node.isMesh) {
        // TODO(https://github.com/mrdoob/three.js/pull/18235): Clean up.
        node.material.depthWrite = !node.material.transparent;
      }
    });

    this.setClips(clips);
    this.playAllClips();

    this.updateLights();
    this.updateGUI();
    this.updateEnvironment();
    this.updateTextureEncoding();
    this.updateBackground();
    this.updateDisplay();

    window.VIEWER.scene = this.content;

    this.printGraph(this.content);
  }

  printGraph(node) {
    console.group(' <' + node.type + '> ' + node.name);
    node.children.forEach((child) => this.printGraph(child));
    console.groupEnd();
  }

  /**
   * @param {Array<THREE.AnimationClip} clips
   */
  setClips(clips) {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }

    this.clips = clips;
    if (!clips.length) return;

    this.mixer = new AnimationMixer(this.content);
  }

  playAllClips() {
    this.clips.forEach((clip) => {
      this.mixer.clipAction(clip).reset().play();
      this.state.actionStates[clip.name] = true;
    });
  }

  /**
   * @param {string} name
   */
  setCamera(name) {
    if (name === DEFAULT_CAMERA) {
      this.controls.enabled = true;
      this.activeCamera = this.defaultCamera;
    } else {
      this.controls.enabled = false;
      this.content.traverse((node) => {
        if (node.isCamera && node.name === name) {
          this.activeCamera = node;
        }
      });
    }
  }

  updateTextureEncoding() {
    const encoding = this.state.textureEncoding === 'sRGB'
        ? sRGBEncoding
        : LinearEncoding;

    traverseMaterials(this.content, (material) => {
      if (material.map) material.map.encoding = encoding;
      if (material.emissiveMap) material.emissiveMap.encoding = encoding;
      if (material.map || material.emissiveMap) material.needsUpdate = true;
    });
  }

  updateLights() {
    const state = this.state;
    const lights = this.lights;

    if (state.punctualLights && !lights.length) {
      this.addLights();
    } else if (!state.punctualLights && lights.length) {
      this.removeLights();
    }

    this.renderer.toneMapping = Number(state.toneMapping);
    this.renderer.toneMappingExposure = Math.pow(2, state.exposure);

    if (lights.length === 2) {
      lights[0].intensity = state.ambientIntensity;
      lights[0].color.setHex(state.ambientColor);
      lights[1].intensity = state.directIntensity;
      lights[1].color.setHex(state.directColor);
    }
  }

  addLights() {
    const state = this.state;

    if (this.options.preset === Preset.ASSET_GENERATOR) {
      const hemiLight = new HemisphereLight();
      hemiLight.name = 'hemi_light';
      this.scene.add(hemiLight);
      this.lights.push(hemiLight);
      return;
    }

    const light1 = new AmbientLight(state.ambientColor, state.ambientIntensity);
    light1.name = 'ambient_light';
    this.defaultCamera.add(light1);

    const light2 = new DirectionalLight(state.directColor, state.directIntensity);
    light2.position.set(0.5, 0, 0.866); // ~60º
    light2.name = 'main_light';
    this.defaultCamera.add(light2);

    this.lights.push(light1, light2);
  }

  removeLights() {
    this.lights.forEach((light) => light.parent.remove(light));
    this.lights.length = 0;
  }

  updateEnvironment() {
    const environment = environments.filter((entry) => entry.name === this.state.environment)[0];

    this.getCubeMapTexture(environment).then(({ envMap }) => {
      if (this.vignette) {
        if ((!envMap || !this.state.background) && this.activeCamera === this.defaultCamera) {
          this.scene.add(this.vignette);
        } else {
          this.scene.remove(this.vignette);
        }
      }

      this.scene.environment = envMap;
      this.scene.background = this.state.background ? envMap : null;
    });
  }

  getCubeMapTexture(environment) {
    const { id, path } = environment;

    // neutral (THREE.RoomEnvironment)
    if (id === 'neutral') {
      return Promise.resolve({ envMap: this.neutralEnvironment });
    }

    // none
    if (id === '') {
      return Promise.resolve({ envMap: null });
    }

    return new Promise((resolve, reject) => {
      new RGBELoader()
          .load(path, (texture) => {
            const envMap = this.pmremGenerator.fromEquirectangular(texture).texture;

            this.pmremGenerator.dispose();

            resolve({ envMap });
          }, undefined, reject);
    });

  }

  updateDisplay() {
    if (this.skeletonHelpers.length) {
      this.skeletonHelpers.forEach((helper) => this.scene.remove(helper));
    }

    traverseMaterials(this.content, (material) => {
      material.wireframe = this.state.wireframe;
    });

    this.content.traverse((node) => {
      if (node.isMesh && node.skeleton && this.state.skeleton) {
        const helper = new SkeletonHelper(node.skeleton.bones[0].parent);
        helper.material.linewidth = 3;
        this.scene.add(helper);
        this.skeletonHelpers.push(helper);
      }
    });

    if (this.state.grid !== Boolean(this.gridHelper)) {
      if (this.state.grid) {
        this.gridHelper = new GridHelper();
        this.axesHelper = new AxesHelper();
        this.axesHelper.setColors();
        this.axesHelper.renderOrder = 999;
        this.axesHelper.onBeforeRender = (renderer) => renderer.clearDepth();
        this.scene.add(this.gridHelper);
        this.scene.add(this.axesHelper);
      } else {
        this.scene.remove(this.gridHelper);
        this.scene.remove(this.axesHelper);
        this.gridHelper = null;
        this.axesHelper = null;
        this.axesRenderer.clear();
      }
    }
  }

  updateBackground() {
    this.vignette && this.vignette.style({ colors: [this.state.bgColor1, this.state.bgColor2] });
  }

  /**
   * Adds AxesHelper.
   *
   * See: https://stackoverflow.com/q/16226693/1314762
   */
  addAxesHelper() {
    this.axesDiv = document.createElement('div');
    this.el.appendChild(this.axesDiv);
    this.axesDiv.classList.add('axes');

    const { clientWidth, clientHeight } = this.axesDiv;

    this.axesScene = new Scene();
    this.axesCamera = new PerspectiveCamera(50, clientWidth / clientHeight, 0.1, 10);
    this.axesScene.add(this.axesCamera);

    this.axesRenderer = new WebGLRenderer({ alpha: true });
    this.axesRenderer.setPixelRatio(window.devicePixelRatio);
    this.axesRenderer.setSize(this.axesDiv.clientWidth, this.axesDiv.clientHeight);

    this.axesCamera.up = this.defaultCamera.up;

    this.axesCorner = new AxesHelper(5);
    this.axesScene.add(this.axesCorner);
    this.axesDiv.appendChild(this.axesRenderer.domElement);
  }

  addGUI() {
    this.$controls = H5P.jQuery('<div/>', {
      'class': 'h5p-3d-viewer-controls'
    }).appendTo(this.el);

    this.createActionButton({
      title: 'Toggle fullscreen',
      icon: 'fullscreen',
      action: 'fullscreen',
      callback: this.toggleFullscreen.bind(this),
    });

    this.createActionButton({
      title: 'Zoom In',
      icon: 'add',
      action: 'zoom-in',
      callback: this.zoomIn.bind(this),
    });

    this.createActionButton({
      title: 'Zoom Out',
      icon: 'remove',
      action: 'zoom-out',
      callback: this.zoomOut.bind(this),
    });

    this.createActionButton({
      title: 'Reset',
      icon: 'center_focus_strong',
      action: 'reset',
      callback: this.resetCamera.bind(this),
    });

    this.el.onfullscreenchange = (event) => {
      this.isFullscreen = !this.isFullscreen;
    }
  }

  updateGUI() {
  }

  createActionButton(data) {
    const { title, icon, action, callback } = data;
    const $button = H5P.jQuery('<button/>', {
      'title': title,
      'class': `h5p-3d-viewer-control ${action}`,
      'html': `<i class="material-icons-outlined" aria-hidden="true">${icon}</i>`,
      'click': (event) => {
        event.preventDefault();

        if (typeof callback === 'function') {
          callback();
        }
      }
    });

    $button.appendTo(this.$controls);
  }

  clear() {
    if (!this.content) return;

    this.scene.remove(this.content);

    // dispose geometry
    this.content.traverse((node) => {
      if (!node.isMesh) return;

      node.geometry.dispose();
    });

    // dispose textures
    traverseMaterials(this.content, (material) => {
      for (const key in material) {
        if (key !== 'envMap' && material[key] && material[key].isTexture) {
          material[key].dispose();
        }
      }
    });
  }

  // UI API methods
  zoomIn() {
    this.controls.enabled = false;

    new TWEEN.Tween(this.activeCamera.position)
        .to(new Vector3().copy(this.activeCamera.position).divideScalar(ZOOM_FACTOR), 400)
        .onComplete(() => {
          this.controls.enabled = true;
        })
        .easing(TWEEN.Easing.Cubic.InOut)
        .start();
  }

  zoomOut() {
    this.controls.enabled = false;

    new TWEEN.Tween(this.activeCamera.position)
        .to(new Vector3().copy(this.activeCamera.position).multiplyScalar(ZOOM_FACTOR), 400)
        .easing(TWEEN.Easing.Cubic.InOut)
        .onComplete(() => {
          this.controls.enabled = true;
        })
        .start();
  }

  resetCamera() {
    this.controls.enabled = false;

    // @todo: Rotate before scaling.
    new TWEEN.Tween(this.activeCamera.position)
        .to(this.activeCameraPosition, 400)
        .onComplete(() => {
          this.controls.enabled = true;
        })
        .easing(TWEEN.Easing.Cubic.InOut)
        .start();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement &&    // alternative standard method
        !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {  // current working methods
      if (this.el.requestFullscreen) {
        this.el.requestFullscreen();
      } else if (this.el.msRequestFullscreen) {
        this.el.msRequestFullscreen();
      } else if (this.el.mozRequestFullScreen) {
        this.el.mozRequestFullScreen();
      } else if (this.el.webkitRequestFullscreen) {
        this.el.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }

  }
}

function traverseMaterials(object, callback) {
  object.traverse((node) => {
    if (!node.isMesh) return;

    const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];

    materials.forEach(callback);
  });
}

// https://stackoverflow.com/a/9039885/1314762
function isIOS() {
  return [
        'iPad Simulator',
        'iPhone Simulator',
        'iPod Simulator',
        'iPad',
        'iPhone',
        'iPod'
      ].includes(navigator.platform)
      // iPad on iOS 13 detection
      || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
}
