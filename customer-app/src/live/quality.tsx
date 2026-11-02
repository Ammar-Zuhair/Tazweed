import { useState, useCallback } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Page, Header, Card, Txt, Action } from "../ui/components";
import { api, useAuth, LoginPanel, Input } from "./connection";
import { useOperation } from "./operations";
import { pickUpload } from "./upload";
export function Review() {
  return <Quality review />;
}
export function Complaint() {
  return <Quality review={false} />;
}
function Quality({ review }: { review: boolean }) {
  const { user } = useAuth(),
    { id } = useLocalSearchParams<{ id: string }>();
  return (
    <QualityView key={(user?.id ?? "guest") + id + review} review={review} />
  );
}
function QualityView({ review }: { review: boolean }) {
  const { user } = useAuth(),
    { id } = useLocalSearchParams<{ id: string }>(),
    r = useRouter(),
    op = useOperation(user?.id);
  const [d, setD] = useState<any>(null),
    [rating, setRating] = useState(0),
    [text, setText] = useState(""),
    [media, setMedia] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [confirm, setConfirm] = useState(false);
  async function load() {
    setBusy(true);
    setConfirm(false);
    try {
      setD(await api("/orders/" + id));
      setError("");
    } catch (e) {
      setD(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useFocusEffect(
    useCallback(() => {
      if (user && id) void load();
      return () => setD(null);
    }, [user?.id, id]),
  );
  async function send() {
    setError("");
    try {
      await op.execute(
        "/orders/" + id + "/" + (review ? "review" : "complaints"),
        {
          expectedVersion: d.order.version,
          ...(review
            ? { rating, comment: text }
            : { details: text, ...(media ? { attachmentId: media } : {}) }),
        },
      );
      setNotice(
        review
          ? "حفظ الخادم تقييمك"
          : "استلم الخادم الشكوى؛ ستجد رد الإدارة هنا",
      );
      setText("");
      setMedia("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const locked = busy || uploading || op.busy || !!op.command || !op.ready;
  return (
    <Page>
      <Header
        title={review ? "تقييم الطلب" : "شكوى الطلب"}
        subtitle={d ? "طلب #" + d.order.order_number : "متابعة طلبك"}
      />
      <Action
        secondary
        title="العودة للطلب"
        onPress={() => r.replace({ pathname: "/order", params: { id } })}
      />
      {!user ? (
        <LoginPanel />
      ) : (
        <>
          <Action
            secondary
            title="تحديث المتابعة"
            disabled={busy}
            onPress={() => void load()}
          />
          {op.command && (
            <Card>
              <Txt>العملية محفوظة وتنتظر إقرار الخادم.</Txt>
              <Action
                title="إعادة محاولة الإرسال"
                disabled={op.busy}
                onPress={() =>
                  void op
                    .execute()
                    .then(() => {
                      setNotice("أقر الخادم العملية");
                      return load();
                    })
                    .catch((e) => setError(e.message))
                }
              />
            </Card>
          )}
          {d?.order.status === "delivered" ? (
            <>
              {review && d.review ? (
                <Card>
                  <Txt weight="bold">تقييمك {d.review.rating}/5</Txt>
                  <Txt>{d.review.comment_ar}</Txt>
                  <Txt>يمكن تقييم الطلب مرة واحدة.</Txt>
                </Card>
              ) : (
                <Card>
                  {review && (
                    <>
                      <Txt weight="bold">اختر تقييمًا من1إلى5</Txt>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Action
                          key={n}
                          secondary
                          title={
                            (rating === n ? "★ " : "") + "تقييم " + n + " من5"
                          }
                          disabled={locked}
                          onPress={() => setRating(n)}
                        />
                      ))}
                    </>
                  )}
                  <Input
                    label={
                      review ? "ملاحظات التقييم (اختياري)" : "تفاصيل الشكوى"
                    }
                    value={text}
                    onChange={setText}
                  />
                  {!review && (
                    <Action
                      title={
                        media ? "الصورة جاهزة" : "إرفاق صورة للشكوى (اختياري)"
                      }
                      secondary
                      disabled={locked}
                      onPress={() => {
                        setUploading(true);
                        void pickUpload("complaint", user.id)
                          .then((id) => {
                            if (id) setMedia(id);
                          })
                          .catch((e) => setError(e.message))
                          .finally(() => setUploading(false));
                      }}
                    />
                  )}
                  <Action
                    title={review ? "مراجعة التقييم" : "مراجعة الشكوى"}
                    disabled={locked || (review ? !rating : !text)}
                    onPress={() => setConfirm(true)}
                  />
                  {confirm && (
                    <Action
                      title={
                        review ? "تأكيد إرسال التقييم" : "تأكيد إرسال الشكوى"
                      }
                      disabled={locked}
                      onPress={() => void send()}
                    />
                  )}
                </Card>
              )}
              {!review &&
                d.complaints.map((c: any) => (
                  <Card key={c.id}>
                    <Txt weight="bold">
                      {
                        (
                          {
                            open: "مفتوحة",
                            in_progress: "قيد المعالجة",
                            resolved: "محلولة",
                          } as any
                        )[c.status]
                      }
                    </Txt>
                    <Txt>{c.details_ar}</Txt>
                    <Txt>
                      رد الإدارة: {c.admin_response ?? "بانتظار المراجعة"}
                    </Txt>
                  </Card>
                ))}
            </>
          ) : (
            d && <Txt>التقييم والشكاوى متاحان بعد التسليم.</Txt>
          )}
        </>
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
      {!!notice && <Txt accessibilityLiveRegion="polite">{notice}</Txt>}
    </Page>
  );
}
