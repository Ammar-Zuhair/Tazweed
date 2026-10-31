import { useState } from "react";
import { useAdmin } from "../../data/admin-provider";
import { accessibleBranches, money, can } from "../../domain/admin-model";
import type { Branch, Province } from "../../domain/types";
import { stockModes } from "../../domain/labels";
import {
  Action,
  BranchScope,
  Card,
  Choice,
  Choices,
  Field,
  Hint,
  MiniMap,
  Save,
  Select,
  Shell,
  Txt,
  stamp,
  uid,
  useConfirm,
} from "../components";
export function InventoryScreen() {
  const { state } = useAdmin();
  const [product, setProduct] = useState("oil-1");
  const [branch, setBranch] = useState(
    state.selectedBranch ?? accessibleBranches(state)[0]?.id ?? "",
  );
  const [target, setTarget] = useState("sanaa");
  const [mode, setMode] = useState<"receive" | "adjust" | "count" | "transfer">(
    "receive",
  );
  const [cartons, setCartons] = useState("2");
  const [pieces, setPieces] = useState("3");
  const [reason, setReason] = useState("");
  const p = state.products.find((p) => p.id === product);
  const factor =
    p?.units.find((u) => u.kind === "carton" && u.active)?.pieces ?? 0;
  const quantity = Number(cartons) * factor + Number(pieces);
  const confirm = useConfirm();
  const branches = accessibleBranches(state);
  return (
    <Shell
      title="مخزون الفروع"
      permission={
        can(state, "inventory.adjust", branch) ||
        can(state, "inventory.transfer", branch)
          ? undefined
          : "inventory.adjust"
      }
      branchId={branch}
    >
      <BranchScope />
      <Select
        label="فرع حركة المخزون"
        value={branch}
        options={branches.map((b) => ({ id: b.id, name: b.name }))}
        onChange={setBranch}
      />
      <Select
        label="منتج المخزون"
        value={product}
        options={state.products.map((p) => ({ id: p.id, name: p.name }))}
        onChange={setProduct}
      />
      {state.stock
        .filter((x) => x.branchId === branch && x.productId === product)
        .map((x) => (
          <Card key={`${x.branchId}-${x.productId}`}>
            <Txt weight="bold">رصيد {p?.name}</Txt>
            <Txt testID="stock-totals">
              فعلي {x.onHand} · محجوز {x.reserved} · حر {x.onHand - x.reserved}{" "}
              حبة
            </Txt>
            <Hint>الأرقام إدارية فقط. العميل يرى التوفر دون عدادات.</Hint>
          </Card>
        ))}
      <Card>
        <Select<"receive" | "adjust" | "count" | "transfer">
          label="نوع حركة المخزون"
          value={mode}
          options={(
            [
              { id: "receive", name: "إدخال" },
              { id: "adjust", name: "تسوية مسببّة" },
              { id: "count", name: "جرد فعلي" },
              { id: "transfer", name: "نقل بين فرعين" },
            ] as const
          ).filter((x) =>
            can(
              state,
              x.id === "transfer" ? "inventory.transfer" : "inventory.adjust",
              branch,
            ),
          )}
          onChange={setMode}
        />
        <Hint>
          الجرد يحول العدد النهائي إلى حركة فرق. التسوية تقبل فرقًا سالبًا. لا
          تعديل رصيد بلا حركة أو استهلاك محجوز.
        </Hint>
        <Field
          label="عدد الكراتين"
          value={cartons}
          onChangeText={setCartons}
          editable={factor > 0}
          keyboardType="numeric"
        />
        <Field
          label="عدد الحبات"
          value={pieces}
          onChangeText={setPieces}
          keyboardType="numeric"
        />
        <Txt testID="stock-conversion">
          {cartons} × {factor} + {pieces} = {quantity} حبة
        </Txt>
        {!factor && (
          <Hint>لا وحدة كرتون نشطة لهذا المنتج؛ الإدخال بالحبة فقط.</Hint>
        )}
        {mode === "transfer" && (
          <Select
            label="فرع الاستلام"
            value={target}
            options={state.branches
              .filter((b) => b.id !== branch)
              .map((b) => ({ id: b.id, name: b.name }))}
            onChange={setTarget}
          />
        )}
        <Field
          label="سبب حركة المخزون *"
          multiline
          value={reason}
          onChangeText={setReason}
        />
        <Save
          title="مراجعة حركة المخزون"
          onPress={() =>
            confirm.ask(
              "تأكيد حركة مخزون",
              `${stockModes[mode]} · ${mode === "count" ? "الرصيد الفعلي بعد الجرد" : "عدد الحبات في الحركة"}: ${quantity} · ${reason}`,
              {
                type: "stock",
                branchId: branch,
                productId: product,
                mode,
                pieces: quantity,
                toBranchId: target,
                reason,
                confirmed: true,
              },
            )
          }
        />
      </Card>
      <Txt weight="bold">سجل الحركات — لا حذف أو تعديل</Txt>
      {state.movements
        .filter((x) => x.branchId === branch && x.productId === product)
        .slice()
        .reverse()
        .map((x) => (
          <Card key={x.id}>
            <Txt>
              {x.delta > 0 ? "+" : ""}
              {x.delta} حبة · {x.reason}
            </Txt>
            <Txt style={{ fontSize: 12 }}>
              {stamp(x.at)} · {x.transferId ?? x.orderId ?? x.id}
            </Txt>
          </Card>
        ))}
      {confirm.dialog}
    </Shell>
  );
}
const provinceForm = (): Province => ({
  id: uid("gov"),
  name: "",
  active: true,
  order: 1,
  catalogBranchId: null,
});
export function BranchesScreen() {
  const { state, send } = useAdmin();
  const [province, setProvince] = useState<Province>(provinceForm);
  const [branch, setBranch] = useState<Branch>({
    id: uid("branch"),
    name: "",
    provinceId: "gov-empty",
    active: true,
    latitude: 12.79,
    longitude: 45.02,
    coverage: 0,
    maxDistance: 0,
    base: 0,
    perKm: 0,
    deliveryEnabled: false,
  });
  const set = (v: Partial<Branch>) => setBranch({ ...branch, ...v });
  return (
    <Shell
      title="المحافظات والفروع"
      permission="branches.write"
      branchId={null}
    >
      <Hint warning>
        كل المواقع والتعرفة والتغطية fixtures، لا بيانات تشغيل معتمدة. فرع نشط
        واحد للمحافظة حاليًا؛ لا اختيار أقرب فرع.
      </Hint>
      <Card>
        <Txt weight="bold">المحافظات</Txt>
        <Choices>
          <Choice
            label="محافظة جديدة"
            selected={!state.provinces.some((p) => p.id === province.id)}
            onPress={() => setProvince(provinceForm())}
          />
          {state.provinces.map((p) => (
            <Choice
              key={p.id}
              label={p.name}
              selected={province.id === p.id}
              onPress={() => setProvince({ ...p })}
            />
          ))}
        </Choices>
        <Field
          label="اسم المحافظة *"
          value={province.name}
          onChangeText={(name) => setProvince({ ...province, name })}
        />
        <Field
          label="ترتيب المحافظة"
          value={String(province.order)}
          onChangeText={(x) => setProvince({ ...province, order: Number(x) })}
          keyboardType="numeric"
        />
        <Choice
          label="المحافظة نشطة"
          selected={province.active}
          onPress={() => setProvince({ ...province, active: !province.active })}
        />
        <Select
          label="فرع كتالوج المحافظة الصريح"
          value={province.catalogBranchId ?? "none"}
          options={[
            { id: "none", name: "غير مهيأ" },
            ...state.branches
              .filter((b) => b.provinceId === province.id)
              .map((b) => ({ id: b.id, name: b.name })),
          ]}
          onChange={(x) =>
            setProvince({
              ...province,
              catalogBranchId: x === "none" ? null : x,
            })
          }
        />
        <Save
          title="حفظ المحافظة"
          onPress={() => send({ type: "province", value: province })}
        />
      </Card>
      <Card>
        <Txt weight="bold">الفروع والتوصيل</Txt>
        <Choices>
          <Choice
            label="فرع جديد"
            selected={!state.branches.some((b) => b.id === branch.id)}
            onPress={() =>
              setBranch({
                id: uid("branch"),
                name: "",
                provinceId: state.provinces[0]!.id,
                active: true,
                latitude: 12.79,
                longitude: 45.02,
                coverage: 0,
                maxDistance: 0,
                base: 0,
                perKm: 0,
                deliveryEnabled: false,
              })
            }
          />
          {state.branches.map((b) => (
            <Choice
              key={b.id}
              label={b.name}
              selected={branch.id === b.id}
              onPress={() => setBranch({ ...b })}
            />
          ))}
        </Choices>
        <Field
          label="اسم الفرع *"
          value={branch.name}
          onChangeText={(name) => set({ name })}
        />
        <Select
          label="محافظة الفرع"
          value={branch.provinceId}
          options={state.provinces.map((p) => ({ id: p.id, name: p.name }))}
          onChange={(provinceId) => set({ provinceId })}
        />
        <MiniMap
          latitude={branch.latitude}
          longitude={branch.longitude}
          onChange={(latitude, longitude) => set({ latitude, longitude })}
        />
        <Field
          label="خط عرض الفرع"
          value={String(branch.latitude)}
          onChangeText={(x) => set({ latitude: Number(x) })}
          keyboardType="numeric"
        />
        <Field
          label="خط طول الفرع"
          value={String(branch.longitude)}
          onChangeText={(x) => set({ longitude: Number(x) })}
          keyboardType="numeric"
        />
        {[
          ["coverage", "نطاق التغطية بالمتر"],
          ["maxDistance", "حد الطريق بالمتر"],
          ["base", "أساس التوصيل بالريال"],
          ["perKm", "زيادة الكيلومتر بالريال"],
        ].map(([key, label]) => (
          <Field
            key={key}
            label={label!}
            value={String(branch[key as "coverage"])}
            keyboardType="numeric"
            onChangeText={(x) => set({ [key!]: Number(x) })}
          />
        ))}
        <Hint>
          floor_km ثابت: 2800م ←2كم. معاينة هذه التعرفة:{" "}
          {money(branch.base + 2 * branch.perKm)}. الخريطة ليست مصدر مسافة
          الطريق.
        </Hint>
        <Choice
          label="الفرع نشط"
          selected={branch.active}
          onPress={() => set({ active: !branch.active })}
        />
        <Choice
          label="التوصيل مهيأ"
          selected={branch.deliveryEnabled}
          onPress={() => set({ deliveryEnabled: !branch.deliveryEnabled })}
        />
        <Save
          title="حفظ الفرع والتعرفة"
          onPress={() => send({ type: "branch", value: branch })}
        />
      </Card>
    </Shell>
  );
}
