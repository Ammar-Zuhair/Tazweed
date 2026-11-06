import { canUploadProof,privateDeliveryMedia } from "../delivery/media-access.js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import { Router } from "express";
import type pg from "pg";
import type { Config } from "../config.js";
import { ApiError, parse, notFound, forbidden } from "../http.js";
import {
  authenticate,
  accessScope,
  requirePermission,
  type Identity,
} from "../identity/access.js";
import type { Security } from "../identity/security.js";
import { transaction } from "../db.js";
import { audit } from "../identity/audit.js";
import * as c from "./contracts.js";
export interface ObjectStore {
  readonly mode: "unconfigured" | "r2" | "test";
  presignPut(key: string, mime: string, size: number): Promise<string>;
  read(key: string, limit: number): Promise<Buffer>;
  write(
    key: string,
    data: Buffer,
    visibility: "public" | "private",
  ): Promise<void>;
  remove(key: string): Promise<void>;
  access(key: string, visibility: "public" | "private"): Promise<string>;
}
const unavailable = () =>
  new ApiError(503, "R2_UNAVAILABLE", "خدمة الملفات غير مهيأة أو غير متاحة");
export class UnconfiguredStore implements ObjectStore {
  readonly mode = "unconfigured" as const;
  async presignPut(): Promise<string> {
    throw unavailable();
  }
  async read(): Promise<Buffer> {
    throw unavailable();
  }
  async write(): Promise<void> {
    throw unavailable();
  }
  async remove(): Promise<void> {
    throw unavailable();
  }
  async access(): Promise<string> {
    throw unavailable();
  }
}
export class R2Store implements ObjectStore {
  readonly mode = "r2" as const;
  private client: S3Client;
  constructor(private config: Config) {
    this.client = new S3Client({
      region: "auto",
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY_ID!,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
      },
      requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
      maxAttempts: 2,
    });
  }
  bucket(key: string) {
    return key.startsWith("public/")
      ? this.config.R2_PUBLIC_BUCKET!
      : this.config.R2_PRIVATE_BUCKET!;
  }
  async presignPut(key: string, mime: string, size: number) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket(key),
        Key: key,
        ContentType: mime,
        ContentLength: size,
      }),
      {
        expiresIn: 300,
        signableHeaders: new Set(["content-type", "content-length"]),
      },
    );
  }
  async read(key: string, limit: number) {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket(key), Key: key }),
    );
    if (!head.ContentLength || head.ContentLength > limit)
      throw new ApiError(
        422,
        "INVALID_FILE_SIZE",
        "حجم الملف لا يطابق المسموح",
      );
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket(key), Key: key }),
    );
    if (!r.Body) throw unavailable();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of r.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > limit) {
        (r.Body as any).destroy?.();
        throw new ApiError(
          422,
          "INVALID_FILE_SIZE",
          "حجم الملف أكبر من المسموح",
        );
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  async write(key: string, data: Buffer, visibility: "public" | "private") {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(key),
        Key: key,
        Body: data,
        ContentType: "image/webp",
        CacheControl:
          visibility === "public"
            ? "public,max-age=31536000,immutable"
            : "private,no-store",
      }),
    );
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket(key), Key: key }),
    );
  }
  async access(key: string, visibility: "public" | "private") {
    if (visibility === "public")
      return (
        this.config.R2_PUBLIC_BASE_URL +
        "/" +
        key.split("/").map(encodeURIComponent).join("/")
      );
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket(key),
        Key: key,
        ResponseContentType: "image/webp",
        ResponseContentDisposition: "inline",
      }),
      { expiresIn: 90 },
    );
  }
}
export const storeFromConfig = (config: Config): ObjectStore =>
  config.R2_ACCOUNT_ID &&
  config.R2_ACCESS_KEY_ID &&
  config.R2_SECRET_ACCESS_KEY &&
  config.R2_PUBLIC_BUCKET &&
  config.R2_PRIVATE_BUCKET &&
  config.R2_PUBLIC_BASE_URL
    ? new R2Store(config)
    : new UnconfiguredStore();
export async function verifyImage(bytes: Buffer, mime: string, size: number) {
  if (bytes.length !== size)
    throw new ApiError(422, "INVALID_FILE_SIZE", "حجم الصورة لا يطابق الطلب");
  const sniff = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    ? "jpeg"
    : bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "png"
      : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP"
        ? "webp"
        : null;
  if ("image/" + sniff !== mime)
    throw new ApiError(422, "INVALID_MIME", "محتوى الصورة لا يطابق نوعها");
  try {
    const image = sharp(bytes, {
        limitInputPixels: 24000000,
        failOn: "warning",
      }),
      meta = await image.metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) throw Error();
    const output = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(output.data)
      .resize({
        width: 360,
        height: 360,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 75 })
      .toBuffer();
    return {
      data: output.data,
      thumbnail,
      width: output.info.width,
      height: output.info.height,
    };
  } catch {
    throw new ApiError(
      422,
      "INVALID_IMAGE",
      "الصورة تالفة أو أبعادها غير مسموحة",
    );
  }
}
export function mediaRouter(
  pool: pg.Pool,
  security: Security,
  store: ObjectStore,
) {
  const r = Router();
  r.get("/media/:id/public", async (req, res) => {
    const id = parse(c.id, req.params.id),
      m = (
        await pool.query(
          `SELECT object_key,thumbnail_key FROM media_objects m WHERE id=$1 AND visibility='public' AND status='verified' AND (EXISTS(SELECT 1 FROM product_images pi JOIN products p ON p.id=pi.product_id JOIN categories c ON c.id=p.category_id WHERE pi.media_id=m.id AND p.active AND c.active) OR EXISTS(SELECT 1 FROM categories c WHERE c.image_id=m.id AND c.active))`,
          [id],
        )
      ).rows[0];
    if (!m) throw notFound();
    try {
      res.json({
        url: await store.access(m.object_key, "public"),
        thumbnailUrl: await store.access(
          m.thumbnail_key ?? m.object_key,
          "public",
        ),
      });
    } catch {
      throw unavailable();
    }
  });
  r.use("/media", authenticate(pool, security));
  r.post("/media/uploads", async (req, res) => {
    const v = parse(c.upload, req.body),
      i = res.locals.identity as Identity;
    const pub = ["product", "category", "banner"].includes(v.purpose);
    if (pub)
      await requirePermission(
        pool,
        i,
        v.purpose === "banner" ? "promotions.write" : "catalog.write",
        null,
      );
    else if (v.purpose === "receipt" || v.purpose === "complaint") {
      if (i.kind !== "customer") throw forbidden();
    } else if (v.purpose === "financial_proof") {
      await canUploadProof(pool,i);
    } else if (v.purpose === "customer_flag") {
      if(i.kind !== "courier") {
        const scope=await accessScope(pool,i,"customer-flags.write");
        if(!scope.global&&!scope.branchIds.length)throw forbidden();
      }
    } else
      throw new ApiError(
        422,
        "PURPOSE_DEFERRED",
        "هذا الاستخدام غير متاح في06",
      );
    if (store.mode === "unconfigured") throw unavailable();
    const id = randomUUID(),
      staging = "staging/" + i.id + "/" + id,
      key = (pub ? "public/" : "private/") + i.id + "/" + id + ".webp";
    let putUrl: string;
    try {
      putUrl = await store.presignPut(staging, v.mime, v.size);
    } catch {
      throw unavailable();
    }
    await pool.query(
      `INSERT INTO media_objects(id,owner_id,object_key,visibility,purpose,mime_type,size_bytes,staging_key,upload_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '5 minutes')`,
      [
        id,
        i.id,
        key,
        pub ? "public" : "private",
        v.purpose,
        v.mime,
        v.size,
        staging,
      ],
    );
    res.status(201).json({
      uploadId: id,
      putUrl,
      expiresIn: 300,
      headers: { "Content-Type": v.mime, "Content-Length": String(v.size) },
    });
  });
  r.post("/media/uploads/:id/complete", async (req, res) => {
    const id = parse(c.id, req.params.id),
      i = res.locals.identity as Identity;
    parse((await import("zod")).z.strictObject({}), req.body ?? {});
    const result = await transaction(pool, async (db) => {
      const m = (
        await db.query(
          "SELECT * FROM media_objects WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [id, i.id],
        )
      ).rows[0];
      if (!m) throw notFound();
      if (m.status === "verified") return { id: m.id, status: "verified" };
      if (
        m.status !== "pending" ||
        new Date(m.upload_expires_at).getTime() <= Date.now()
      )
        throw new ApiError(409, "UPLOAD_EXPIRED", "انتهت صلاحية الرفع");
      if (m.visibility === "public")
        await requirePermission(
          db,
          i,
          m.purpose === "banner" ? "promotions.write" : "catalog.write",
          null,
        );
      let data: Buffer;
      try {
        data = await store.read(m.staging_key, Number(m.size_bytes));
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw unavailable();
      }
      const clean = await verifyImage(data, m.mime_type, Number(m.size_bytes));
      const thumb = m.object_key.replace(".webp", "-thumb.webp");
      try {
        await store.write(m.object_key, clean.data, m.visibility);
        await store.write(thumb, clean.thumbnail, m.visibility);
      } catch {
        throw unavailable();
      }
      await db.query(
        `UPDATE media_objects SET status='verified',mime_type='image/webp',size_bytes=$2,sha256=$3,width=$4,height=$5,thumbnail_key=$6 WHERE id=$1`,
        [
          id,
          clean.data.length,
          createHash("sha256").update(clean.data).digest("hex"),
          clean.width,
          clean.height,
          thumb,
        ],
      );
      await audit(
        db,
        res.locals.requestId,
        i.id,
        "media.verified",
        "media",
        id,
      );
      return { id, status: "verified" };
    });
    // Staging is never served. A replayed PUT can only rewrite this private staging key.
    const m = (
      await pool.query("SELECT staging_key FROM media_objects WHERE id=$1", [
        id,
      ])
    ).rows[0];
    await store.remove(m.staging_key).catch(() => {});
    res.json(result);
  });
  r.get("/media/:id/access", async (req, res) => {
    const id = parse(c.id, req.params.id),
      i = res.locals.identity as Identity,
      m = (
        await pool.query(
          `SELECT * FROM media_objects m WHERE id=$1 AND status='verified' AND NOT EXISTS(SELECT 1 FROM privacy_file_deletions d WHERE d.media_id=m.id AND d.next_attempt_at<=now())`,
          [id],
        )
      ).rows[0];
    if (!m) throw notFound();
    const deliveryMedia = await privateDeliveryMedia(pool,i,m);
    if (!deliveryMedia && (m.owner_id !== i.id || m.purpose === "financial_proof")) {
      if (m.visibility === "public") {
        await requirePermission(pool, i, "catalog.write", null);
      } else {
        if (m.purpose === "financial_proof") {
          const rows = (
            await pool.query(
              `SELECT e.branch_id,o.branch_id current_branch,o.catalog_branch_id FROM financial_exception_resolutions r JOIN financial_exceptions e ON e.id=r.exception_id JOIN orders o ON o.id=e.order_id WHERE r.proof_media_id=$1`,
              [id],
            )
          ).rows;
          if (!rows.length) {
            if (m.owner_id !== i.id) throw notFound();
            const scope = await accessScope(
              pool,
              i,
              "financial-exceptions.resolve",
            );
            if (!scope.global && !scope.branchIds.length) throw forbidden();
          } else
            await requirePermission(
              pool,
              i,
              "financial-exceptions.resolve",
              rows.flatMap((r) => [
                r.branch_id ?? r.catalog_branch_id,
                r.current_branch ?? r.catalog_branch_id,
              ]),
            );
        } else {
          if (m.purpose !== "receipt") throw notFound();
          const orders = (
            await pool.query(
              "SELECT DISTINCT q.branch_id,o.branch_id current_branch,o.catalog_branch_id FROM payment_receipt_attempts a JOIN payments p ON p.id=a.payment_id JOIN order_quotes q ON q.id=p.quote_id JOIN orders o ON o.id=p.order_id WHERE a.media_id=$1",
              [id],
            )
          ).rows;
          if (!orders.length || orders.some((o) => !o.branch_id))
            throw notFound();
          await requirePermission(
            pool,
            i,
            "payments.verify",
            orders.flatMap((o) => [
              o.branch_id,
              o.current_branch ?? o.catalog_branch_id,
            ]),
          );
        }
      }
    }
    try {
      res.json({
        url: await store.access(m.object_key, m.visibility),
        expiresIn: m.visibility === "private" ? 90 : null,
      });
    } catch {
      throw unavailable();
    }
  });
  return r;
}
// Clean expired staging and abandoned pending outputs. Never delete verified final objects.
export async function prunePendingMedia(pool: pg.Pool, store: ObjectStore) {
  if (store.mode === "unconfigured") return 0;
  return transaction(pool, async (db) => {
    const rows = (
      await db.query(
        `SELECT id,status,staging_key,object_key FROM media_objects WHERE status IN ('pending','verified') AND staging_key IS NOT NULL AND upload_expires_at<now()-interval '24 hours' ORDER BY upload_expires_at LIMIT 20 FOR UPDATE SKIP LOCKED`,
      )
    ).rows;
    let n = 0;
    for (const m of rows) {
      await store.remove(m.staging_key);
      if (m.status === "pending") {
        await store.remove(m.object_key);
        await store.remove(m.object_key.replace(".webp", "-thumb.webp"));
        await db.query(
          "UPDATE media_objects SET status='deleted',staging_key=NULL WHERE id=$1",
          [m.id],
        );
      } else
        await db.query(
          "UPDATE media_objects SET staging_key=NULL WHERE id=$1",
          [m.id],
        );
      n++;
    }
    return n;
  });
}
