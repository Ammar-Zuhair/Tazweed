import { useState } from "react";
import { useAdmin } from "../../data/admin-provider";
import { actor, can } from "../../domain/admin-model";
import {
  permissionNames,
  type Permission,
  type Role,
  type Staff,
} from "../../domain/types";
import {
  Action,
  BranchScope,
  Card,
  Choice,
  Choices,
  Field,
  Hint,
  Save,
  Select,
  Shell,
  Txt,
  stamp,
  uid,
  useConfirm,
} from "../components";
const newRole = (): Role => ({ id: uid("role"), name: "", permissions: [] });
const newStaff = (): Staff => ({
  id: uid("staff"),
  name: "",
  phone: "",
  active: true,
  grants: [],
});
export function StaffScreen() {
  const { state } = useAdmin();
  const [role, setRole] = useState<Role>(newRole);
  const [staff, setStaff] = useState<Staff>(newStaff);
  const [grantRole, setGrantRole] = useState("reviewer");
  const [grantBranch, setGrantBranch] = useState("aden");
  const confirm = useConfirm();
  return (
    <Shell title="الموظفون والأدوار" permission="staff.manage" branchId={null}>
      <Hint warning>
        حسابات داخلية تجريبية، لا تسجيل عام أو دعوة أو تغيير صلاحيات خادم.
        الصلاحية ونطاق الفرع يفحصان معًا لكل إجراء.
      </Hint>
      <Hint>
        الكتالوج والخصائص والفروع ووسائل التحويل والتسويق والموظفون والصيانة
        والإصدارات تتطلب منحة عامة. الطلبات والمخزون والموصلون والمال تقيد
        بصلاحية الإجراء والفرع معًا.
      </Hint>
      <Card>
        <Txt weight="bold">الأدوار</Txt>
        <Choices>
          <Choice
            label="دور جديد"
            selected={!state.roles.some((r) => r.id === role.id)}
            onPress={() => setRole(newRole())}
          />
          {state.roles.map((r) => (
            <Choice
              key={r.id}
              label={r.name}
              selected={r.id === role.id}
              onPress={() => setRole({ ...r, permissions: [...r.permissions] })}
            />
          ))}
        </Choices>
        <Field
          label="اسم الدور *"
          value={role.name}
          onChangeText={(name) => setRole({ ...role, name })}
        />
        <Choices>
          {(Object.entries(permissionNames) as [Permission, string][]).map(
            ([p, name]) => (
              <Choice
                key={p}
                label={name}
                selected={role.permissions.includes(p)}
                onPress={() =>
                  setRole({
                    ...role,
                    permissions: role.permissions.includes(p)
                      ? role.permissions.filter((x) => x !== p)
                      : [...role.permissions, p],
                  })
                }
              />
            ),
          )}
        </Choices>
        <Save
          title="مراجعة حفظ الدور"
          onPress={() =>
            confirm.ask(
              "حفظ صلاحيات الدور",
              `${role.name} · ${role.permissions.length} صلاحية. تتأثر المنح المرتبطة بهذا الدور.`,
              { type: "role", value: role, confirmed: true },
            )
          }
        />
      </Card>
      <Card>
        <Txt weight="bold">حسابات الموظفين ونطاقهم</Txt>
        <Choices>
          <Choice
            label="موظف داخلي جديد"
            selected={!state.staff.some((s) => s.id === staff.id)}
            onPress={() => setStaff(newStaff())}
          />
          {state.staff.map((s) => (
            <Choice
              key={s.id}
              label={s.name}
              selected={s.id === staff.id}
              onPress={() => setStaff(JSON.parse(JSON.stringify(s)))}
            />
          ))}
        </Choices>
        <Field
          label="اسم الموظف *"
          value={staff.name}
          onChangeText={(name) => setStaff({ ...staff, name })}
        />
        <Field
          label="هاتف الموظف التجريبي *"
          value={staff.phone}
          onChangeText={(phone) => setStaff({ ...staff, phone })}
          keyboardType="phone-pad"
        />
        <Choice
          label="الموظف نشط"
          selected={staff.active}
          onPress={() => setStaff({ ...staff, active: !staff.active })}
        />
        <Select
          label="دور المنحة"
          value={grantRole}
          options={state.roles.map((r) => ({ id: r.id, name: r.name }))}
          onChange={setGrantRole}
        />
        <Select
          label="نطاق المنحة"
          value={grantBranch}
          options={[
            { id: "global", name: "عام — كل الفروع والإجراءات العامة" },
            ...state.branches.map((b) => ({ id: b.id, name: b.name })),
          ]}
          onChange={setGrantBranch}
        />
        <Action
          title="إضافة الدور مع هذا النطاق"
          secondary
          onPress={() =>
            setStaff({
              ...staff,
              grants: [
                ...staff.grants,
                {
                  roleId: grantRole,
                  branchId: grantBranch === "global" ? null : grantBranch,
                },
              ],
            })
          }
        />
        {staff.grants.map((g, i) => (
          <Card key={`${g.roleId}-${g.branchId}-${i}`}>
            <Txt>
              {state.roles.find((r) => r.id === g.roleId)?.name} ·{" "}
              {g.branchId
                ? state.branches.find((b) => b.id === g.branchId)?.name
                : "نطاق عام"}
            </Txt>
            <Action
              title={`إزالة المنحة ${i + 1}`}
              secondary
              onPress={() =>
                setStaff({
                  ...staff,
                  grants: staff.grants.filter((_g, n) => n !== i),
                })
              }
            />
          </Card>
        ))}
        <Hint>
          المراجع770000003 يرى الطلب دون تفاصيل إيصال أو بلاغ محمي. أمين
          المخزن770000004 لا يستطيع نقلًا إلى فرع غير مخول. كلمة الاختبار
          المشتركة محلية فقط.
        </Hint>
        <Save
          title="مراجعة حفظ الموظف"
          onPress={() =>
            confirm.ask(
              "حفظ موظف داخلي ونطاقه",
              `${staff.name} · ${staff.grants.length} منحة · ${staff.active ? "نشط" : "موقوف"}`,
              { type: "staff", value: staff, confirmed: true },
            )
          }
        />
      </Card>
      {confirm.dialog}
    </Shell>
  );
}
export function QualityScreen() {
  const { state, send } = useAdmin();
  const [kind, setKind] = useState("complaint");
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState<"open" | "in_progress" | "resolved">(
    "in_progress",
  );
  const rows = state.complaints.filter((c) => {
    const o = state.orders.find((o) => o.id === c.orderId);
    return (
      o &&
      c.type === kind &&
      can(
        state,
        c.type === "flag" ? "customer-flags.read" : "complaints.manage",
        o.branchId ?? o.catalogBranchId,
      ) &&
      (!state.selectedBranch ||
        (o.branchId ?? o.catalogBranchId) === state.selectedBranch)
    );
  });
  return (
    <Shell title="الشكاوى والتقييمات">
      <BranchScope />
      <Select
        label="نوع سجل الجودة"
        value={kind}
        options={[
          { id: "complaint", name: "شكاوى العميل" },
          { id: "rating", name: "التقييمات" },
          { id: "flag", name: "بلاغ موظف على عميل" },
        ]}
        onChange={setKind}
      />
      <Hint>
        بلاغات العميل تنبيه للمخول عند الطلب الجديد، دون حظر آلي. التقييم1–5 مرة
        للطلب المسلم؛ لا تقييم منتج أو موصل مستقل.
      </Hint>
      <Field
        label="رد إداري *"
        multiline
        value={response}
        onChangeText={setResponse}
      />
      <Select
        label="حالة المعالجة"
        value={status}
        options={[
          { id: "open", name: "مفتوح" },
          { id: "in_progress", name: "قيد المعالجة" },
          { id: "resolved", name: "محلول" },
        ]}
        onChange={setStatus}
      />
      {rows.length === 0 && (
        <Card>
          <Txt>لا سجلات مخولة بهذا النطاق.</Txt>
        </Card>
      )}
      {rows.map((c) => (
        <Card key={c.id}>
          <Txt weight="bold">
            {c.orderId} ·{" "}
            {c.type === "rating"
              ? `${c.rating}/5`
              : {
                  open: "مفتوح",
                  in_progress: "قيد المعالجة",
                  resolved: "محلول",
                }[c.status]}
          </Txt>
          <Txt>{c.text}</Txt>
          <Txt>{c.response || "لا رد بعد"}</Txt>
          <Save
            title={`حفظ معالجة ${c.id}`}
            onPress={() =>
              send({ type: "complaint", id: c.id, status, response })
            }
          />
        </Card>
      ))}
    </Shell>
  );
}
export function AuditScreen() {
  const { state } = useAdmin();
  const [query, setQuery] = useState("");
  const rows = state.audit
    .filter(
      (a) =>
        can(state, "audit.read", a.branchId) &&
        (!state.selectedBranch || a.branchId === state.selectedBranch) &&
        `${a.action} ${a.summary} ${a.actor}`.includes(query),
    )
    .slice()
    .reverse();
  return (
    <Shell title="سجل التدقيق" permission="audit.read">
      <BranchScope />
      <Field label="بحث في سجل التدقيق" value={query} onChangeText={setQuery} />
      <Hint>
        أثر محلي غير قابل للتحرير من الواجهة. لا كلمات مرور أو OTP أو روابط
        إيصال خاصة ضمنه؛ إثبات خادم append-only في05+.
      </Hint>
      {rows.map((a) => (
        <Card key={a.id}>
          <Txt weight="bold">{a.summary}</Txt>
          <Txt>
            {a.actor} · {stamp(a.at)}
          </Txt>
          <Txt style={{ fontSize: 12 }}>
            {a.action} · {a.branchId ?? "عام"}
          </Txt>
        </Card>
      ))}
      {rows.length === 0 && <Txt>لا سجل مطابق.</Txt>}
    </Shell>
  );
}
