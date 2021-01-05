import { WebGLRenderer, ImageUtils, PerspectiveCamera, AxesHelper, Scene, RGBFormat, DragControls, LinearMipmapLinearFilter, sRGBEncoding } from 'three';
import { PCFSoftShadowMap, WebGLCubeRenderTarget, Texture, SpriteMaterial, Sprite, spriteAlignment, CubeCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

import { EVENT_UPDATED, EVENT_LOADED, EVENT_ITEM_REMOVED, EVENT_ITEM_SELECTED, EVENT_ITEM_MOVE, EVENT_ITEM_MOVE_FINISH, EVENT_NO_ITEM_SELECTED, EVENT_WALL_CLICKED, EVENT_ROOM_CLICKED, EVENT_EXTERNAL_FLOORPLAN_LOADED, EVENT_GLTF_READY, EVENT_NEW_ITEM, EVENT_NEW_ROOMS_ADDED, EVENT_MODE_RESET } from '../core/events.js';
// import { EVENT_NEW, EVENT_DELETED } from '../core/events.js';

import { Skybox } from './skybox.js';
import { Edge3D } from './edge3d.js';
import { Floor3D } from './floor3d.js';
import { Lights3D } from './lights3d.js';
import { Physical3DItem } from './Physical3DItem.js';
import { DragRoomItemsControl3D } from './DragRoomItemsControl3D.js';
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

import { Model } from '../model/model.js';

/*import {Cannon} from "cannon/src/Cannon";*/

export class Viewer3D extends Scene {
    constructor(model, element, opts) {
        super();
        let options = { occludedRoofs: false, occludedWalls: false, resize: true, pushHref: false, spin: true, spinSpeed: .00002, clickPan: true, canMoveFixedItems: false };
        for (let opt in options) {
            if (options.hasOwnProperty(opt) && opts.hasOwnProperty(opt)) {
                options[opt] = opts[opt];
            }
        }

        this.__physicalRoomItems = [];
        this.__enabled = true;
        this.model = model;
        this.models = new Model();
        this.floorplan = this.model.floorplan;
        this.__options = options;

        this.domElement = document.getElementById(element);

        this.perspectivecamera = null;
        this.camera = null;
        this.__environmentCamera = null;

        this.cameraNear = 0.1;
        this.cameraFar = 10000;

        this.controls = null;

        this.renderer = null;
        this.controller = null;

        this.needsUpdate = false;
        this.lastRender = Date.now();

        this.heightMargin = null;
        this.widthMargin = null;
        this.elementHeight = null;
        this.elementWidth = null;
        this.pauseRender = false;

        this.edges3d = [];
        this.floors3d = [];

        this.__externalEdges3d = [];
        this.__externalFloors3d = [];

        this.__currentItemSelected = null;

        this.needsUpdate = true;

        this.__newItemEvent = this.__addNewItem.bind(this);
        this.__wallSelectedEvent = this.__wallSelected.bind(this);
        this.__roomSelectedEvent = this.__roomSelected.bind(this);
        this.__roomItemSelectedEvent = this.__roomItemSelected.bind(this);
        this.__roomItemUnselectedEvent = this.__roomItemUnselected.bind(this);
        this.__roomItemDraggedEvent = this.__roomItemDragged.bind(this);
        this.__roomItemDragFinishEvent = this.__roomItemDragFinish.bind(this);

        this.__resetDesignEvent = this.__resetDesign.bind(this);

        this.init();
    }

    init() {
        let scope = this;

        ImageUtils.crossOrigin = '';

        scope.camera = new PerspectiveCamera(45, 10, scope.cameraNear, scope.cameraFar);

        let cubeRenderTarget = new WebGLCubeRenderTarget(16, { format: RGBFormat, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
        scope.__environmentCamera = new CubeCamera(1, 100000, cubeRenderTarget);
        scope.__environmentCamera.renderTarget.texture.encoding = sRGBEncoding;

        scope.renderer = scope.getARenderer();
        scope.domElement.appendChild(scope.renderer.domElement);

        scope.lights = new Lights3D(this, scope.floorplan);
        // scope.dragcontrols = new DragControls(this.physicalRoomItems, scope.camera, scope.renderer.domElement);
        scope.dragcontrols = new DragRoomItemsControl3D(this.floorplan.wallPlanesForIntersection, this.floorplan.floorPlanesForIntersection, this.physicalRoomItems, scope.camera, scope.renderer.domElement);
        scope.controls = new OrbitControls(scope.camera, scope.domElement);
        // scope.controls.autoRotate = this.__options['spin'];
        scope.controls.enableDamping = false;
        scope.controls.dampingFactor = 0.1;
        scope.controls.maxPolarAngle = Math.PI * 1.0; //Math.PI * 0.5; //Math.PI * 0.35;
        scope.controls.maxDistance = 2500; //2500
        scope.controls.minDistance = 1; //1000; //1000
        scope.controls.screenSpacePanning = true;

        scope.skybox = new Skybox(this, scope.renderer);
        scope.camera.position.set(0, 600, 1500);
        scope.controls.update();

        //scope.axes = new AxesHelper(500);


        // handle window resizing
        scope.updateWindowSize();

        if (scope.__options.resize) {
            window.addEventListener('resize', () => { scope.updateWindowSize(); });
            window.addEventListener('orientationchange', () => { scope.updateWindowSize(); });
        }

        scope.model.addEventListener(EVENT_NEW_ITEM, scope.__newItemEvent);
        scope.model.addEventListener(EVENT_MODE_RESET, scope.__resetDesignEvent);
        // scope.model.addEventListener(EVENT_LOADED, (evt) => scope.addRoomItems(evt));
        // scope.floorplan.addEventListener(EVENT_UPDATED, (evt) => scope.addWalls(evt));

        scope.model.addEventListener(EVENT_LOADED, scope.addRoomItems.bind(scope));

        // scope.floorplan.addEventListener(EVENT_UPDATED, scope.addRoomsAndWalls.bind(scope));
        scope.floorplan.addEventListener(EVENT_NEW_ROOMS_ADDED, scope.addRoomsAndWalls.bind(scope));
        scope.floorplan.addEventListener(EVENT_EXTERNAL_FLOORPLAN_LOADED, scope.addExternalRoomsAndWalls.bind(scope));

        this.controls.addEventListener('change', () => { scope.needsUpdate = true; });


        scope.dragcontrols.addEventListener(EVENT_ITEM_SELECTED, this.__roomItemSelectedEvent);
        scope.dragcontrols.addEventListener(EVENT_ITEM_REMOVED, this.__roomItemDeleteEvent);
        scope.dragcontrols.addEventListener(EVENT_ITEM_MOVE, this.__roomItemDraggedEvent);
        scope.dragcontrols.addEventListener(EVENT_ITEM_MOVE_FINISH, this.__roomItemDragFinishEvent);
        scope.dragcontrols.addEventListener(EVENT_NO_ITEM_SELECTED, this.__roomItemUnselectedEvent);

        scope.dragcontrols.addEventListener(EVENT_WALL_CLICKED, this.__wallSelectedEvent);
        scope.dragcontrols.addEventListener(EVENT_ROOM_CLICKED, this.__roomSelectedEvent);
        // scope.controls.enabled = false;//To test the drag controls

        //SEt the animation loop
        scope.renderer.setAnimationLoop(scope.render.bind(this));
        scope.render();
        let controls = this.controls;
        let scene = this;
        const loader = new GLTFLoader();
        let menuItemSelected = document.getElementById("selected-item-menu").value;
        let menuClickItem = document.getElementsByClassName("sub-menu-item");
        let b = this.physicalRoomItems;

    
        
        [].forEach.call(menuClickItem,function(el){
            el.addEventListener('click', function (e) {
                let click = this.dataset.name
                selectedUrlModel = click;
                console.log(click);
                
                function getItemsforadd(){
                    console.log(b.length);
                    for(let i=0; i< b.length; i++){
                        if(b[i].__itemModel.__metadata.itemName === click){
                            b[i].visible = true;
                          
                            scene.add(b[i])
                            scope.render();
                            scope.controls.update();
                            scope.renderer;
                            scope.needsUpdate = true;
                        }
                    }
                }
                if(selectedUrlModel === click){
                    setTimeout(() => getItemsforadd(), 100);
                }
               // addNewItems();
            })
        });
        
        let testobj = new Physical3DItem (this);
        let selectedUrlModel;

        let testmodel = this.models;
        let a = this.physicalRoomItems;
        
        
       function addNewItems(){
            loader.load(
                //'zzz.glb',
                selectedUrlModel,
                function ( gltf ) {
                    scene.add( gltf.scene);
                    scene.add( spritey );
                    scene.add(testobj);
                    for(let i = 0; i < gltf.scene.children.length; i++){
                        gltf.scene.children[i].position.set(500, 100, 500);
                        testobj.add(gltf.scene.children[i]);
                        testmodel.__roomItems.push(gltf.scene.children[i]);
                        scope.dragcontrols.__draggableItems.push(testobj.__itemModel);
                       
                        controls.addEventListener( 'dragstart', function ( event ) {
                            
                            event.object.material.emissive.set( 0xaaaaaa );
                        
                        } );
                        
                        controls.addEventListener( 'dragend', function ( event ) {
                        
                            event.object.material.emissive.set( 0x000000 );
                        
                        } );
                    }
                    console.log(testmodel.__roomItems);
                    // let c = models.items()
                    console.log(testobj);
                }
            )
        }

        function roundRect(ctx, x, y, w, h, r) // http://stemkoski.github.io/Three.js/
        {
            ctx.beginPath();
            ctx.moveTo(x+r, y);
            ctx.lineTo(x+w-r, y);
            ctx.quadraticCurveTo(x+w, y, x+w, y+r);
            ctx.lineTo(x+w, y+h-r);
            ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
            ctx.lineTo(x+r, y+h);
            ctx.quadraticCurveTo(x, y+h, x, y+h-r);
            ctx.lineTo(x, y+r);
            ctx.quadraticCurveTo(x, y, x+r, y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();   
        }

            function makeTextSprite( message, parameters )
            {
                if ( parameters === undefined ) parameters = {};
                
                var fontface = parameters.hasOwnProperty("fontface") ? 
                    parameters["fontface"] : "Arial";
                
                var fontsize = parameters.hasOwnProperty("fontsize") ? 
                    parameters["fontsize"] : 18;
                
                var borderThickness = parameters.hasOwnProperty("borderThickness") ? 
                    parameters["borderThickness"] : 4;
                
                var borderColor = parameters.hasOwnProperty("borderColor") ?
                    parameters["borderColor"] : { r:0, g:0, b:0, a:1.0 };
                
                var backgroundColor = parameters.hasOwnProperty("backgroundColor") ?
                    parameters["backgroundColor"] : { r:255, g:255, b:255, a:1.0 };

            // var spriteAlignment = SpriteAlignment.topLeft;
                    
                var canvas = document.createElement('canvas');
                var context = canvas.getContext('2d');
                context.font = "Bold " + fontsize + "px " + fontface;
                
                // get size data (height depends only on font size)
                var metrics = context.measureText( message );
                var textWidth = metrics.width;
                
                // background color
                context.fillStyle   = "rgba(" + backgroundColor.r + "," + backgroundColor.g + ","
                                            + backgroundColor.b + "," + backgroundColor.a + ")";
                // border color
                context.strokeStyle = "rgba(" + borderColor.r + "," + borderColor.g + ","
                                            + borderColor.b + "," + borderColor.a + ")";

                context.lineWidth = borderThickness;
                roundRect(context, borderThickness/2, borderThickness/2, textWidth + borderThickness, fontsize * 1.4 + borderThickness, 6);
                // 1.4 is extra height factor for text below baseline: g,j,p,q.
                
                // text color
                context.fillStyle = "rgba(0, 0, 0, 1.0)";

                context.fillText( message, borderThickness, fontsize + borderThickness);
                
                // canvas contents will be used for a texture

                var texture = new Texture(canvas);
                texture.needsUpdate = true;

                var spriteMaterial = new SpriteMaterial( 
                    { map: texture, useScreenCoordinates: false, alignment: spriteAlignment } );
                var sprite = new Sprite( spriteMaterial );
                sprite.scale.set(1000,500,10.0);
                return sprite;	
            }

            var spritey = makeTextSprite( " Hello, ", 
            { fontsize: 24, borderColor: {r:255, g:0, b:0, a:1.0}, backgroundColor: {r:255, g:100, b:100, a:0.8} } );
            spritey.position.set(85,105,55);

    }
    clickMenu(){
        console.log("click")
    }
    

    addNewItems(){
        loader.load(
            //'zzz.glb',
            selectedUrlModel,
            function ( gltf ) {
               // var a = fullItems.dispose();
                //scope.dragcontrols.__draggableItems.push(selectedUrlModel)
                scene.add( gltf.scene);
                scene.add( spritey );
                testobj.add(selectedUrlModel);
                for(let i = 0; i < gltf.scene.children.length; i++){
                    gltf.scene.children[i].position.set(500, 100, 500);
                }
                console.log(scope.dragcontrols.__draggableItems);
                // let c = models.items()
                console.log(selectedUrlModel);
            }
        )
    }

    __wallSelected(evt) {
        this.dispatchEvent(evt);
    }

    __roomSelected(evt) {
        this.dispatchEvent(evt);
    }

    


    testss(evt){
        if (this.__currentItemSelected) {
            this.__currentItemSelected.selected = false;
        }
        this.__currentItemSelected = evt.item;
        this.__currentItemSelected.selected = true;
        this.needsUpdate = true;
        evt.itemModel = this.__currentItemSelected.itemModel;
        console.log(evt.item)
        this.dispatchEvent(evt);
    }
    
  

    removeThisItem(evt){
        let scope = this;
        let thisItem = this.__currentItemSelected;
        this.remove(thisItem);
        scope.needsUpdate = true;
        scope.render();
        scope.controls.update();
        scope.renderer;
    }

    rotationModel(value){
        //let round = Math.PI/2; // maybe
        let thisItem = this.__currentItemSelected;
        thisItem.rotation.set(0, value, 0);
        this.needsUpdate = true;
        console.log(thisItem.rotation);
    }

    __roomItemSelected(evt) {
        if (this.__currentItemSelected) {
            this.__currentItemSelected.selected = false;
        }
        this.__currentItemSelected = evt.item;
        this.__currentItemSelected.selected = true;
        this.needsUpdate = true;
        evt.itemModel = this.__currentItemSelected.itemModel;
        this.dispatchEvent(evt);
    }

    __roomItemDragged(evt) {
        this.controls.enabled = false;
        for (let i = 0; i < this.__physicalRoomItems.length; i++) {
            //if(this.__physicalRoomItems[i].visible === true){
                // this.__physicalRoomItems[i].__box.copy( this.__physicalRoomItems[i].geometry.boundingBox).applyMatrix4( this.__physicalRoomItems[i].matrixWorld );
                // let a = this.__currentItemSelected.__box.intersectsBox(this.__physicalRoomItems[3].__box);
                // console.log(a);

                // var box1 = this.__physicalRoomItems[3].geometry.boundingBox.clone();
                // box1.applyMatrix4(this.__physicalRoomItems[3].matrixWorld);

                // var box2 = this.__currentItemSelected.geometry.boundingBox.clone();
                // box2.applyMatrix4(this.__currentItemSelected.matrixWorld);
              
                // console.log( box1.intersectsBox(box2));

                this.needsUpdate = true;

            //}
        }
    }

    __roomItemDragFinish(evt) {
        this.controls.enabled = true;
    }

    __roomItemUnselected(evt) {
        this.controls.enabled = true;
        if (this.__currentItemSelected) {
            this.__currentItemSelected.selected = false;
            this.__currentItemSelected = null;
            this.needsUpdate = true;
        }
        this.dispatchEvent(evt);
    }

    __addNewItem(evt) {
        if (!evt.item) {
            return;
        }
        let physicalRoomItem = new Physical3DItem(evt.item, this.__options);
        this.add(physicalRoomItem);
        this.__physicalRoomItems.push(physicalRoomItem);
        this.__roomItemSelected({ type: EVENT_ITEM_SELECTED, item: physicalRoomItem });
    }

    __resetDesign(evt) {
        this.addRoomItems();
        this.addRoomsAndWalls();
        this.addExternalRoomsAndWalls();
    }

    addRoomItems(evt) {
        let i = 0;
        for (; i < this.__physicalRoomItems.length; i++) {
            this.__physicalRoomItems[i].dispose();
            this.remove(this.__physicalRoomItems[i]);
        }
        this.__physicalRoomItems.length = 0; //A cool way to clear an array in javascript
        let roomItems = this.model.roomItems;
        for (i = 0; i < roomItems.length; i++) {
            let physicalRoomItem = new Physical3DItem(roomItems[i], this.__options);
            this.add(physicalRoomItem);
            this.__physicalRoomItems.push(physicalRoomItem);
        }

    }

    addRoomsAndWalls() {
        let scope = this;
        let i = 0;

        // clear scene
        scope.floors3d.forEach((floor) => {
            floor.destroy();
            floor = null;
        });

        scope.edges3d.forEach((edge3d) => {
            edge3d.remove();
            edge3d = null;
        });

        scope.edges3d = [];
        scope.floors3d = [];
        let wallEdges = scope.floorplan.wallEdges();
        let rooms = scope.floorplan.getRooms();

        // draw floors
        for (i = 0; i < rooms.length; i++) {
            var threeFloor = new Floor3D(scope, rooms[i], scope.controls, this.__options);
            scope.floors3d.push(threeFloor);
        }

        for (i = 0; i < wallEdges.length; i++) {
            let edge3d = new Edge3D(scope, wallEdges[i], scope.controls, this.__options);
            scope.edges3d.push(edge3d);
        }

        scope.shouldRender = true;

        let floorplanCenter = scope.floorplan.getDimensions(true);
        scope.controls.target = floorplanCenter.clone();
        scope.camera.position.set(floorplanCenter.x, 300, floorplanCenter.z * 5);
        scope.controls.update();
    }


    addExternalRoomsAndWalls() {
        // console.trace('ADD EXTERNAL ROOMS AND WALLS');
        let scope = this;
        let i = 0;

        // clear scene
        scope.__externalFloors3d.forEach((floor) => {
            floor.destroy();
            floor = null;
        });

        scope.__externalEdges3d.forEach((edge3d) => {
            edge3d.remove();
            edge3d = null;
        });

        scope.__externalEdges3d = [];
        scope.__externalFloors3d = [];

        let wallEdges = scope.floorplan.externalWallEdges();
        let rooms = scope.floorplan.externalRooms;

        // draw floors
        for (i = 0; i < rooms.length; i++) {
            var threeFloor = new Floor3D(scope, rooms[i], scope.controls, this.__options);
            scope.__externalFloors3d.push(threeFloor);
        }

        for (i = 0; i < wallEdges.length; i++) {
            let edge3d = new Edge3D(scope, wallEdges[i], scope.controls, this.__options);
            scope.__externalEdges3d.push(edge3d);
        }

        scope.shouldRender = true;

        let floorplanCenter = scope.floorplan.getDimensions(true);
        scope.controls.target = floorplanCenter.clone();
        scope.camera.position.set(floorplanCenter.x, 300, floorplanCenter.z * 5);
        scope.controls.update();
    }

    getARenderer() {
        var renderer = new WebGLRenderer({ antialias: true, alpha: true });

        // scope.renderer.autoClear = false;
        renderer.shadowMap.enabled = false;
        renderer.shadowMapSoft = true;
        renderer.shadowMap.type = PCFSoftShadowMap;
        renderer.setClearColor(0xFFFFFF, 1);
        renderer.localClippingEnabled = false;
        // renderer.gammaOutput = false;
        renderer.outputEncoding = sRGBEncoding;
        renderer.setPixelRatio(window.devicePixelRatio);
        // renderer.sortObjects = false;
        return renderer;
    }

    updateWindowSize() {
        var scope = this;

        scope.heightMargin = scope.domElement.offsetTop;
        scope.widthMargin = scope.domElement.offsetLeft;
        scope.elementWidth = scope.domElement.clientWidth;

        if (scope.__options.resize) {
            scope.elementHeight = window.innerHeight - scope.heightMargin;
        } else {
            scope.elementHeight = scope.domElement.clientHeight;
        }
        scope.camera.aspect = scope.elementWidth / scope.elementHeight;
        scope.camera.updateProjectionMatrix();
        scope.renderer.setSize(scope.elementWidth, scope.elementHeight);
        scope.needsUpdate = true;
    }

    render() {
        if (!this.enabled) {
            return;
        }
        let scope = this;
        // scope.controls.update();
        if (!scope.needsUpdate) {
            return;
        }
        scope.renderer.render(scope, scope.camera);
        scope.lastRender = Date.now();
        this.needsUpdate = false;
    }

    exportSceneAsGTLF() {
        let scope = this;
        let exporter = new GLTFExporter();
        exporter.parse(this, function(gltf) {
            scope.dispatchEvent({ type: EVENT_GLTF_READY, gltf: JSON.stringify(gltf) });
        });
    }

    forceRender() {
        let scope = this;
        scope.renderer.render(scope, scope.camera);
        scope.lastRender = Date.now();
    }

    addRoomplanListener(type, listener) {
        this.addEventListener(type, listener);
    }

    removeRoomplanListener(type, listener) {
        this.removeEventListener(type, listener);
    }

    get environmentCamera() {
        return this.__environmentCamera;
    }

    get physicalRoomItems() {
        return this.__physicalRoomItems;
    }

    get enabled() {
        return this.__enabled;
    }

    set enabled(flag) {
        this.__enabled = flag;
        this.controls.enabled = flag;
        if (!flag) {
            this.dragcontrols.deactivate();
        } else {
            this.dragcontrols.activate();
        }
    }

}