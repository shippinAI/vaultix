export const AuthPageFooter = () => (
  <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-muted">
    <p>&copy; {new Date().getFullYear()} AngryVibes LLC</p>
    <a
      href="https://shippin.ai"
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4 hover:text-foreground"
    >
      shippin.ai
    </a>
  </footer>
);
