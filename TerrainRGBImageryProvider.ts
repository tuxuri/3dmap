import {
  Cartesian3,
  Cartographic,
  ClassificationType,
  Color,
  defined,
  Math as CesiumMath,
  PolylineArrowMaterialProperty,
  Rectangle,
  Request,
  UrlTemplateImageryProvider,
  Viewer,
  WebMercatorTilingScheme,
} from "@cesiumgs/cesium-analytics";
import TileCoordinatesImageryProvider from "@cesiumgs/cesium-analytics/Source/Scene/TileCoordinatesImageryProvider";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import destination from "@turf/destination";
import distance from "@turf/distance";
import { Feature, MultiPolygon, point, Polygon } from "@turf/helpers";

class TerrainRGBImageryProvider extends UrlTemplateImageryProvider {
  cutout?: Feature<Polygon>[] | Feature<MultiPolygon>[];
  min?: number;
  max?: number;
  colorRamp?: HTMLCanvasElement;
  imageData?: ImageData;

  requestImage(
    x: number,
    y: number,
    level: number,
    request?: Request | undefined
  ) {
    const imagePromise = super.requestImage(x, y, level, request);
    if (!defined(imagePromise) || !imagePromise) {
      return imagePromise;
    }

    // https://gist.github.com/fasiha/63d2dbb36fc88f72c078
    // https://github.com/davenquinn/cesium-martini/blob/e6585050443e5066fbbdd911bdcfe3e87068745f/src/terrain-provider.ts#L21/
    return Promise.resolve(imagePromise).then((image) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        console.log("error context");
        return image;
      }
      if (defined(image) && image) {
        canvas.width = image.width;
        canvas.height = image.height;
        // context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        if (1) {
          // ImageryProvider fetchImage flipY:true
          // http://jsfiddle.net/yong/ZJQX5/
          let scaleH = 1, // Set horizontal scale to -1 if flip horizontal
            scaleV = -1, // Set verical scale to -1 if flip vertical
            posX = 0, // Set x position to -100% if flip horizontal
            posY = canvas.height * -1;
          context?.scale(scaleH, scaleV);

          context?.drawImage(image, posX, posY);
        } else {
          context?.drawImage(image, 0, 0);
        }

        if (1) {
          // TODO: https://gist.github.com/krhoyt/2c3514f20a05e4916a1caade0782953f
          try {
            image = context.getImageData(
              0,
              0,
              context.canvas.width,
              context.canvas.height
            );
          } catch (e) {
            console.log("catch error", e, { x, y, level });
          }
        }
        if (1) {
          const length = image.data.length; //pixel count * 4
          const rect = this.tilingScheme.tileXYToRectangle(x, y, level);
          // console.log("rect", rect, length / 4);
          const height = context?.canvas.height ?? 0;
          const width = context?.canvas.width ?? 0;
          const inc =
            (CesiumMath.toDegrees(rect.north) -
              CesiumMath.toDegrees(rect.south)) /
            height;
          const incw =
            (CesiumMath.toDegrees(rect.east) -
              CesiumMath.toDegrees(rect.west)) /
            width;
          const ctx = this.colorRamp?.getContext("2d");
          let imageData: ImageData | undefined;
          if (this.max !== undefined && this.min !== undefined && ctx) {
            imageData = ctx.getImageData(0, 0, ctx.canvas.width, 1);
          }
          for (let i = 0; i < length; i += 4) {
            const ni = i / 4;
            const difflng =
              CesiumMath.toDegrees(rect.west) +
              (ni - Math.floor(ni / width) * width) * incw;
            const difflat =
              CesiumMath.toDegrees(rect.north) - Math.floor(ni / width) * inc;

            const cutout = this.cutout as Feature<Polygon>[];
            let inside = false;
            if (cutout) {
              for (let ii = 0; ii < cutout.length; ii++) {
                if (
                  booleanPointInPolygon(point([difflng, difflat]), cutout[ii])
                ) {
                  inside = true;
                  break;
                }
              }
            }
            if (!inside) {
              image.data[i + 3] = 0;
              continue;
            }
            const r = image.data[i];
            const g = image.data[i + 1];
            const b = image.data[i + 2];
            const h = (r * 256 * 256 + g * 256.0 + b) / 10.0 - 10000.0;
            if (this.max !== undefined && this.min !== undefined && imageData) {
              const offset = Math.floor(h - this.min) * 4;
              image.data[i] = imageData.data[offset];
              image.data[i + 1] = imageData.data[offset + 1];
              image.data[i + 2] = imageData.data[offset + 2];
            }
            if (0) {
              if (h < 5000) {
                image.data[i] = 255;
                image.data[i + 1] = 0;
                image.data[i + 2] = 0;
              }
              if (h < 50) {
                image.data[i] = 0;
                image.data[i + 1] = 255;
                image.data[i + 2] = 0;
              }
              if (h < 10) {
                image.data[i] = 0;
                image.data[i + 1] = 0;
                image.data[i + 2] = 255;
              }
              image.data[i + 3] = 100;
            }
          }
        }
      }

      return image;
    });
  }
}

// TODO implement as web worker, see appendix in https://observablehq.com/@slutske22/slope-and-aspect-in-leaflet
export class SlopeImageryProvider extends UrlTemplateImageryProvider {
  cutout?: Feature<Polygon>[] | Feature<MultiPolygon>[];
  min?: number;
  max?: number;
  colorRamp?: HTMLCanvasElement;
  imageData?: ImageData;

  requestImage(
    x: number,
    y: number,
    level: number,
    request?: Request | undefined
  ) {
    const imagePromise = super.requestImage(x, y, level, request);
    if (!imagePromise) {
      return imagePromise;
    }

    function getPixelReadOnly(imgData: Uint8ClampedArray, index: number) {
      let i = index * 4,
        d = imgData;
      return d.subarray(i, i + 4); // Returns array [R,G,B,A]
    }

    // https://stackoverflow.com/a/27706656
    function getPixel(imgData: ImageData, index: number) {
      if (index < 0) {
        index = 0;
      }
      const i = index * 4;
      return imgData.data.subarray(i, i + 4); // Returns array [R,G,B,A]
    }

    function getPixelXY(imgData: ImageData, x: number, y: number) {
      return getPixel(imgData, y * imgData.width + x);
    }

    function getPixelXYReadonly(
      imgData: Uint8ClampedArray,
      x: number,
      y: number,
      width: number
    ) {
      return getPixelReadOnly(imgData, y * width + x);
    }

    function rgbHeight(px: Uint8ClampedArray) {
      const r = px[0];
      const g = px[1];
      const b = px[2];
      let h = (r * 256 * 256 + g * 256.0 + b) / 10.0 - 10000.0;
      return h;
    }

    function rgbHeightCmp(px: Uint8ClampedArray, base: number) {
      let result = rgbHeight(px);
      if (isNaN(result) || result > 1000000 || result < -500) {
        return base;
      }
      return result;
    }

    const { toDegrees } = CesiumMath;

    return Promise.resolve(imagePromise).then((image) => {
      if (!image) {
        return image;
      }
      let canvas: HTMLCanvasElement | undefined =
        document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        return image;
      }
      canvas.width = image.width;
      canvas.height = image.height;

      let scaleH = 1, // Set horizontal scale to -1 if flip horizontal
        scaleV = -1, // Set verical scale to -1 if flip vertical
        posX = 0, // Set x position to -100% if flip horizontal
        posY = canvas.height * -1;
      context.scale(scaleH, scaleV);

      try {
        context.drawImage(image, posX, posY);
      } catch (e) {
        console.error("Error drawImage", e, x, y, level);
      }

      // https://stackoverflow.com/a/27706656
      const outputImageData = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );
      let refImageData: Uint8ClampedArray | undefined = Uint8ClampedArray.from(
        context.getImageData(0, 0, canvas.width, canvas.height).data
      );
      context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.remove();
      canvas = undefined;
      const ctx = this.colorRamp?.getContext("2d");
      let rampImageData: ImageData | undefined;
      if (this.max && this.min !== undefined && ctx) {
        rampImageData = ctx.getImageData(0, 0, ctx.canvas.width, 1);
      }
      if (!rampImageData) {
        return image;
      }
      const data = new Uint32Array(outputImageData.data.buffer);
      const rect = this.tilingScheme.tileXYToRectangle(x, y, level);
      if (!rect) {
        return image;
      }
      const inc =
        (toDegrees(rect.north) - toDegrees(rect.south)) / image.height;
      const incw = (toDegrees(rect.east) - toDegrees(rect.west)) / image.width;
      // console.log("foo", inc);
      const dxlng =
        (distance(
          point([toDegrees(rect.east), toDegrees(rect.south)]),
          point([toDegrees(rect.west), toDegrees(rect.south)])
        ) *
          1000) /
        image.width;
      const dxlat =
        (distance(
          point([toDegrees(rect.west), toDegrees(rect.north)]),
          point([toDegrees(rect.west), toDegrees(rect.south)])
        ) *
          1000) /
        image.width;
      let debugCnt = 0;

      const w = image.width;
      for (let i = 0; i < outputImageData.data.length; i += 4) {
        const ni = i / 4;
        const nx = ni - Math.floor(ni / image.width) * image.width;
        const ny = Math.floor(ni / image.width);
        const px = getPixelXY(outputImageData, nx, ny);
        const pxr = getPixelXYReadonly(refImageData, nx, ny, w);
        const pxoffset = 1;

        const top = getPixelXYReadonly(refImageData, nx, ny - pxoffset, w);
        const bottom = getPixelXYReadonly(refImageData, nx, ny + pxoffset, w);
        const left = getPixelXYReadonly(refImageData, nx - pxoffset, ny, w);
        const right = getPixelXYReadonly(refImageData, nx + pxoffset, ny, w);
        const h = rgbHeight(pxr);
        const eleE = rgbHeightCmp(right, h);
        const eleW = rgbHeightCmp(left, h);
        const eleN = rgbHeightCmp(top, h);
        const eleS = rgbHeightCmp(bottom, h);
        const dx = dxlng * pxoffset * 2;
        const dy = dxlat * pxoffset * 2;
        const dzdx = (eleE - eleW) / dx;
        const dzdy = (eleN - eleS) / dy;

        const slope =
          Math.atan(Math.sqrt(dzdx ** 2 + dzdy ** 2)) * (180 / Math.PI);

        if (
          0 &&
          x === 25618 &&
          y === 16103 &&
          level === 15 &&
          debugCnt < 50 &&
          slope > 0 &&
          // slope < 89 &&
          h > 40
        ) {
          console.log({ nx, ny, slope, val: Math.floor((slope / 90) * 255) });
          debugCnt++;
        }

        if (1 && rampImageData) {
          const ss = slope;
          const offset = Math.floor(ss - this.min) * 4;
          px[0] = rampImageData.data[offset];
          px[1] = rampImageData.data[offset + 1];
          px[2] = rampImageData.data[offset + 2];
          px[3] = 128;
        }
        if (0) {
          px[0] = 0;
          px[1] = 0;
          px[2] = Math.floor((slope / 90) * 255);
        }
      }
      refImageData = undefined;
      if (0) {
        for (let widthX = outputImageData.width; widthX--; ) {
          for (let widthY = outputImageData.height; widthY--; ) {
            const ni = widthY * outputImageData.width + widthX;

            let top = (widthY - 1) * outputImageData.width + widthX;
            let right = widthY * outputImageData.width + widthX + 1;
            let bottom = (widthY + 1) * outputImageData.width + widthX;
            let left = widthY * outputImageData.width + widthX - 1;

            // https://observablehq.com/@slutske22/slope-as-a-function-of-latlng-in-leaflet

            const rt = data[top] & 0x000000ff;
            const gt = (data[top] >> 8) & 0x000000ff;
            const bt = (data[top] >> 16) & 0x000000ff;
            // const alphat = (data[top] >> 24) & 0x000000ff;
            let eleN = (rt * 256 * 256 + gt * 256.0 + bt) / 10.0 - 10000.0;
            const rb = data[bottom] & 0x000000ff;
            const gb = (data[bottom] >> 8) & 0x000000ff;
            const bb = (data[bottom] >> 16) & 0x000000ff;
            // const alphat = (data[top] >> 24) & 0x000000ff;
            let eleS = (rb * 256 * 256 + gb * 256.0 + bb) / 10.0 - 10000.0;
            const rl = data[left] & 0x000000ff;
            const gl = (data[left] >> 8) & 0x000000ff;
            const bl = (data[left] >> 16) & 0x000000ff;
            // const alphat = (data[top] >> 24) & 0x000000ff;
            let eleW = (rl * 256 * 256 + gl * 256.0 + bl) / 10.0 - 10000.0;
            const rr = data[right] & 0x000000ff;
            const gr = (data[right] >> 8) & 0x000000ff;
            const br = (data[right] >> 16) & 0x000000ff;
            // const alphat = (data[top] >> 24) & 0x000000ff;
            let eleE = (rr * 256 * 256 + gr * 256.0 + br) / 10.0 - 10000.0;
            const r = data[ni] & 0x000000ff;
            const g = (data[ni] >> 8) & 0x000000ff;
            const b = (data[ni] >> 16) & 0x000000ff;
            const alpha = (data[ni] >> 24) & 0x000000ff;
            // const alpha = (0 >> 24) & 0x000000ff;
            // const alpha = 0x000000ff;
            const h = (r * 256 * 256 + g * 256.0 + b) / 10.0 - 10000.0;
            if (eleN < 0 || eleN > rampImageData.width) {
              eleN = h;
            }
            if (eleS < 0 || eleS > rampImageData.width) {
              eleS = h;
            }
            if (eleW < 0 || eleW > rampImageData.width) {
              eleW = h;
            }
            if (eleE < 0 || eleE > rampImageData.width) {
              eleE = h;
            }

            const dzdx = (eleE - eleW) / incw;
            const dzdy = (eleN - eleS) / inc;

            const slope =
              Math.atan(Math.sqrt(dzdx ** 2 + dzdy ** 2)) * (180 / Math.PI);
            data[ni] =
              0 |
              (0 << 8) |
              (Math.floor((slope / 90) * 255) << 16) |
              (alpha << 24);
          }
        }
      }

      return outputImageData;
    });
  }
}

export class TerrainAspectImageryProvider extends UrlTemplateImageryProvider {
  cutout?: Feature<Polygon>[] | Feature<MultiPolygon>[];
  min?: number;
  max?: number;
  colorRamp?: HTMLCanvasElement;
  imageData?: ImageData;
  viewer?: Viewer;

  requestImage(
    x: number,
    y: number,
    level: number,
    request?: Request | undefined
  ) {
    const imagePromise = super.requestImage(x, y, level, request);
    if (!defined(imagePromise) || !imagePromise) {
      // not ready or will retry later
      return imagePromise;
    }

    return Promise.resolve(imagePromise).then((image) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        return image;
      }
      if (!image) {
        console.log("expect image", x, y, level);
      }
      let pixels: ImageData | undefined;
      if (defined(image) && image) {
        canvas.width = image.width;
        canvas.height = image.height;
        if (1) {
          let scaleH = 1, // Set horizontal scale to -1 if flip horizontal
            scaleV = -1, // Set verical scale to -1 if flip vertical
            posX = 0, // Set x position to -100% if flip horizontal
            posY = canvas.height * -1;
          context?.scale(scaleH, scaleV);

          context?.drawImage(image, posX, posY, canvas.width, canvas.height);
        } else {
          context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        }

        // if (1) {
        try {
          pixels = context.getImageData(
            0,
            0,
            context.canvas.width,
            context.canvas.height
          );
        } catch (e) {
          pixels = undefined;
          console.log("catch error", e, { x, y, level });
        }
        // }
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (1 && pixels !== undefined) {
          const length = pixels.data.length; //pixel count * 4
          const rect = this.tilingScheme.tileXYToRectangle(x, y, level);
          // console.log("rect", rect, length / 4);
          const height = context?.canvas.height ?? 0;
          const width = context?.canvas.width ?? 0;
          const inc =
            (CesiumMath.toDegrees(rect.north) -
              CesiumMath.toDegrees(rect.south)) /
            height;
          const incw =
            (CesiumMath.toDegrees(rect.east) -
              CesiumMath.toDegrees(rect.west)) /
            width;
          const ctx = this.colorRamp?.getContext("2d");
          let imageData: ImageData | undefined;
          if (this.max !== undefined && this.min !== undefined && ctx) {
            imageData = ctx.getImageData(0, 0, ctx.canvas.width, 1);
          }
          for (let i = 0; i < length; i += 4) {
            const ni = i / 4;
            const difflng =
              CesiumMath.toDegrees(rect.west) +
              (ni - Math.floor(ni / width) * width) * incw;
            const difflat =
              CesiumMath.toDegrees(rect.north) - Math.floor(ni / width) * inc;

            const cutout = this.cutout as Feature<Polygon>[];
            let inside = false;
            if (cutout) {
              for (let ii = 0; ii < cutout.length; ii++) {
                if (
                  booleanPointInPolygon(point([difflng, difflat]), cutout[ii])
                ) {
                  inside = true;
                  break;
                }
              }
            }
            if (!inside) {
              pixels.data[i + 3] = 0;
              continue;
            }
            const r = pixels.data[i];
            const g = pixels.data[i + 1];
            const b = pixels.data[i + 2];
            const h = (r * 256 * 256 + g * 256.0 + b) / 10.0 - 10000.0;
            if (this.max !== undefined && this.min !== undefined && imageData) {
              // const d = ctx.getImageData(0, 0, ctx.canvas.width, 1);
              // const offset = Math.floor(h) * 4;
              const offset = Math.floor(h - this.min) * 4;
              // Math.floor((h / (that.max - that.min)) * ctx.canvas.width) * 4;
              pixels.data[i] = imageData.data[offset];
              pixels.data[i + 1] = imageData.data[offset + 1];
              pixels.data[i + 2] = imageData.data[offset + 2];
            }
            if (0) {
              if (h < 5000) {
                pixels.data[i] = 255;
                pixels.data[i + 1] = 0;
                pixels.data[i + 2] = 0;
              }
              if (h < 50) {
                pixels.data[i] = 0;
                pixels.data[i + 1] = 255;
                pixels.data[i + 2] = 0;
              }
              if (h < 10) {
                pixels.data[i] = 0;
                pixels.data[i + 1] = 0;
                pixels.data[i + 2] = 255;
              }
              pixels.data[i + 3] = 100;
            }
          }
        }
      }

      if (pixels) {
        const offset = Math.floor(pixels.data.length / 4 / 2);
        const [r, g, b] = [
          pixels.data[offset],
          pixels.data[offset + 1],
          pixels.data[offset + 2],
          pixels.data[offset + 3],
        ];
        const h = (r * 256 * 256 + g * 256.0 + b) / 10.0 - 10000.0;

        const rect = this.tilingScheme.tileXYToRectangle(x, y, level);
        const lat =
          (CesiumMath.toDegrees(rect.north) -
            CesiumMath.toDegrees(rect.south)) /
          2;
        const lng =
          (CesiumMath.toDegrees(rect.east) - CesiumMath.toDegrees(rect.west)) /
          2;
        console.log(
          "pixel value",
          r,
          g,
          b,
          h,
          `lnglat: ${CesiumMath.toDegrees(rect.south) + lat}, ${
            CesiumMath.toDegrees(rect.west) + lng
          }`
        );
        const position = Cartesian3.fromDegrees(
          CesiumMath.toDegrees(rect.west) + lng,
          CesiumMath.toDegrees(rect.south) + lat
        );
        const c = Cartographic.fromCartesian(position);
        const pt = point([
          CesiumMath.toDegrees(c.longitude),
          CesiumMath.toDegrees(c.latitude),
        ]);
        const d = destination(pt, 0.1, h);
        const pointX = Cartesian3.fromDegrees(
          d.geometry.coordinates[0],
          d.geometry.coordinates[1],
          c.height
        );
        const newent = this.viewer?.entities.add({
          position,
          polyline: {
            positions: [position, pointX],
            width: 12,
            // arcType: ArcType.NONE,
            clampToGround: true,
            classificationType: ClassificationType.TERRAIN,
            material: new PolylineArrowMaterialProperty(
              Color.YELLOW.withAlpha(0.8)
            ),
            depthFailMaterial: new PolylineArrowMaterialProperty(
              Color.YELLOW.withAlpha(0.8)
            ),
          },
        });
        if (newent) {
          console.log("x=%d, y=%d, level=%d", x, y, level);
        }
        context?.putImageData(pixels, 0, 0);
      }

      return canvas;
    });
  }
}

export class ArrowTerrainAspectImageryProvider extends TileCoordinatesImageryProvider {
  srtm?: TerrainAspectImageryProvider;
  _rectangle?: Rectangle;
  viewer: Viewer;

  constructor(options?: TileCoordinatesImageryProvider.ConstructorOptions) {
    options = { ...options };
    super(options);
    if (!options.tilingScheme) {
      this._tilingScheme = new WebMercatorTilingScheme();
    }
    if (options.rectangle) {
      this._rectangle = options.rectangle;
    }
  }

  get rectangle() {
    return this._rectangle;
  }

  requestImage(
    x: number,
    y: number,
    level: number,
    request?: Request | undefined
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");

    const cssColor = this._color.toCssColorString();

    const prom = this.srtm.requestImage(x, y, level, request);
    if (prom) {
      Promise.resolve(prom).then((img2) => {
        if (1) {
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.width = img2.width;
          canvas.height = img2.height;
          if (context) {
            let scaleH = 1, // Set horizontal scale to -1 if flip horizontal
              scaleV = -1, // Set verical scale to -1 if flip vertical
              posX = 0, // Set x position to -100% if flip horizontal
              posY = img2.height * -1;
            context?.scale(scaleH, scaleV);
            context?.drawImage(img2, posX, posY, img2.width, img2.height);
            const pixels = context.getImageData(
              0,
              0,
              context.canvas.width,
              context.canvas.height
            );

            const rect = this._tilingScheme.tileXYToRectangle(x, y, level);
            const lat =
              (CesiumMath.toDegrees(rect.north) -
                CesiumMath.toDegrees(rect.south)) /
              2;
            const lng =
              (CesiumMath.toDegrees(rect.east) -
                CesiumMath.toDegrees(rect.west)) /
              2;
            console.log(
              "arrow imagedata, tile=%d/%d/%d, lng,lat=%f,%f",
              level,
              x,
              y,
              CesiumMath.toDegrees(rect.west) + lng,
              CesiumMath.toDegrees(rect.south) + lat
            );
            const position = Cartesian3.fromDegrees(
              CesiumMath.toDegrees(rect.west) + lng,
              CesiumMath.toDegrees(rect.south) + lat
            );
            const newent = this.viewer?.entities.add({
              position,
              point: {
                pixelSize: 30,
                color: Color.BLUE,
              },
            });
          }
        }
        if (0 && img2 instanceof HTMLCanvasElement) {
          const ctx = img2.getContext("2d");
          if (ctx) {
            console.log(
              "arrow image, tile=%d/%d/%d",
              level,
              x,
              y,
              ctx.getImageData(0, 0, img2.width, img2.height)
            );
          }
        }
      });
    }

    if (0 && context !== null) {
      context.strokeStyle = cssColor;
      context.lineWidth = 2;
      context.strokeRect(1, 1, 255, 255);

      context.font = "bold 25px Arial";
      context.textAlign = "center";
      context.fillStyle = cssColor;
      context.fillText("M: " + level, 124, 86);
      context.fillText("X: " + x, 124, 136);
      context.fillText("Y: " + y, 124, 186);
    }

    return canvas;
  }
}

export default TerrainRGBImageryProvider;
