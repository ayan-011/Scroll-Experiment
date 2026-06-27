import ScrollVideoAnimation from "./Scrollvideoanimation";

 
export default function App() {
  return (
    <main>
      <ScrollVideoAnimation
        src="/product.mp4"
        scrollHeight={6000}
        overlays={[
          { start: 0.0, end: 0.2, heading: "Meet the Console", body: "Designed from the ground up." },
          { start: 0.4, end: 0.6, heading: "Inside the Machine", body: "Hundreds of components." },
          { start: 0.75, end: 0.95, heading: "Reassembled", body: "Every part in its place." },
        ]}
      />
    </main>
  );
}