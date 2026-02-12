import { Composition } from "remotion";
import { MoltAppDemo } from "./MoltAppDemo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="MoltAppDemo"
      component={MoltAppDemo}
      durationInFrames={1800}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
