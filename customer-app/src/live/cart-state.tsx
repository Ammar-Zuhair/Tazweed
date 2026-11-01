import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type PropsWithChildren,
} from "react";
import { useAuth } from "./connection";
type Cart = {
  gov: string;
  setGov: (v: string) => void;
  draft: Record<string, string>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  names: Record<string, string>;
  remember: (id: string, name: string) => void;
  addressId: string;
  setAddressId: (v: string) => void;
};
const Context = createContext<Cart | null>(null);
export function CartProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [gov, govSet] = useState(""),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [names, setNames] = useState<Record<string, string>>({}),
    [addressId, setAddressId] = useState("");
  const previousUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    setAddressId("");
    if (previousUser.current && previousUser.current !== user?.id) {
      setDraft({});
      setNames({});
    }
    previousUser.current = user?.id;
  }, [user?.id]);
  return (
    <Context.Provider
      value={{
        gov,
        setGov: (v) => {
          govSet(v);
          setAddressId("");
        },
        draft,
        setDraft,
        names,
        remember: (id, name) =>
          setNames((v) => (v[id] === name ? v : { ...v, [id]: name })),
        addressId,
        setAddressId,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCart() {
  const c = useContext(Context);
  if (!c) throw Error("CartProvider missing");
  return c;
}
