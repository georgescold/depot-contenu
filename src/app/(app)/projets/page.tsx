import View from "./view";

// Écran rendu côté navigateur (après la vérification de session) : pas de validation « instantanée ».
export const instant = false;

export default function Page() {
  return <View />;
}
