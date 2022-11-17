import {
  Cartesian3,
  Viewer,
  Math as CesiumMath,
  Rectangle,
} from "@cesiumgs/cesium-analytics";
import TerrainRGBImageryProvider from "./TerrainRGBImageryProvider";
import { Feature, Polygon } from "@turf/helpers";

function getColorRamp(width = 100, height = 1, isSlope = true) {
  let ramp = document.createElement("canvas");
  ramp.width = width;
  ramp.height = height;
  let ctx = ramp.getContext("2d");

  let colorRamp = [0.0, 0.29, 0.5, Math.sqrt(2) / 2, 0.87, 0.91, 1.0];
  if (!isSlope) {
    colorRamp = [0.0, 0.2, 0.4, 0.6, 0.8, 0.9, 1.0];
  }

  let grd = ctx?.createLinearGradient(0, 0, width, 0);
  if (grd && ctx) {
    grd.addColorStop(colorRamp[0], "#000000"); //black
    grd.addColorStop(colorRamp[1], "#2747E0"); //blue
    grd.addColorStop(colorRamp[2], "#D33B7D"); //pink
    grd.addColorStop(colorRamp[3], "#D33038"); //red
    grd.addColorStop(colorRamp[4], "#FF9742"); //orange
    grd.addColorStop(colorRamp[5], "#ffd700"); //yellow
    grd.addColorStop(colorRamp[6], "#ffffff"); //white

    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);
  }

  return ramp;
}

const viewer = new Viewer("cesiumContainer");

let cartesians: Cartesian3[] = [];
const rectangle = Rectangle.fromCartesianArray(cartesians);
const img = new TerrainRGBImageryProvider({
  url: "https://sample.tuxgeo.dev",
  maximumLevel: 15,
  rectangle,
});

const minHeight = 256;
const maxHeight = 256;
const cutout: Feature<Polygon>[] = [];
// TODO: geojson for selected area
img.cutout = cutout;
img.min = minHeight;
img.max = maxHeight;
img.colorRamp = getColorRamp(maxHeight - minHeight);
const imageryLayer = viewer.imageryLayers.addImageryProvider(img);
// use imageryLayer
