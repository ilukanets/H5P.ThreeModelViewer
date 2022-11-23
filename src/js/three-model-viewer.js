import 'material-icons/iconfont/outlined.css';
import { Viewer } from './viewer/viewer';

// noinspection JSUnresolvedVariable
H5P = H5P || {};

const ThreeModelViewer = (function(H5P, $) {

  window.VIEWER = {
    json: null,
    scene: null
  };

  class ThreeModelViewer {
    constructor(el, options) {
      this.el = el;
      this.options = options;

      this.viewerEl = document.createElement('div');
      this.viewerEl.classList.add('h5p-3d-viewer');

      this.spinnerEl = document.createElement('div');
      this.spinnerEl.innerHTML = `
          <div class="spinner">
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                <circle fill="none" r="23" cx="24" cy="24"/>
            </svg>
          </div>
        `;
      this.spinnerEl.classList.add('h5p-3d-viewer-spinner');

      this.hideSpinner();

      this.el.appendChild(this.viewerEl);
      this.el.appendChild(this.spinnerEl);

      if (options.model) {
        this.view(options.model, '', new Map());
      }
    }

    /**
     * Passes a model to the viewer, given file and resources.
     * @param  {File|string} rootFile
     * @param  {string} rootPath
     * @param  {Map<string, File>} fileMap
     */
    view(rootFile, rootPath, fileMap) {
      if (this.viewer) this.viewer.clear();

      this.showSpinner();

      const viewer = this.viewer || this.createViewer();

      const fileURL = typeof rootFile === 'string'
          ? rootFile
          : URL.createObjectURL(rootFile);

      const cleanup = () => {
        this.hideSpinner();

        if (typeof rootFile === 'object') URL.revokeObjectURL(fileURL);
      };

      viewer
          .load(fileURL, rootPath, fileMap)
          .then(() => {
            this.hideSpinner();
          })
          .catch((e) => this.onError(e))
          .then((gltf) => {
            cleanup();
          });
    }


    /**
     * @param  {Error} error
     */
    onError(error) {
      let message = (error || {}).message || error.toString();

      if (message.match(/ProgressEvent/)) {
        message = 'Unable to retrieve this file. Check JS console and browser network tab.';
      } else if (message.match(/Unexpected token/)) {
        message = `Unable to parse file content. Verify that this file is valid. Error: "${message}"`;
      } else if (error && error.target && error.target instanceof Image) {
        message = 'Missing texture: ' + error.target.src.split('/').pop();
      }

      window.alert(message);
      console.error(error);
    }

    /**
     * Sets up the view manager.
     * @return {Viewer}
     */
    createViewer() {
      this.viewer = new Viewer(this.viewerEl, this.options);

      return this.viewer;
    }

    showSpinner() {
      this.spinnerEl.style.display = '';
    }

    hideSpinner() {
      this.spinnerEl.style.display = 'none';
    }
  }

  return ThreeModelViewer;

})(H5P, H5P.$);

export default ThreeModelViewer;
