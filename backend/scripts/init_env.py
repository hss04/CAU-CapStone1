from pathlib import Path
from secrets import token_urlsafe


def main():
    project = Path(__file__).resolve().parents[1]
    destination = project / '.env'
    if destination.exists():
        print('.env already exists; kept unchanged.')
        return
    example = (project / '.env.example').read_text(encoding='utf-8')
    example = example.replace('replace-with-a-random-secret-at-least-32-characters',token_urlsafe(48))
    with destination.open('x',encoding='utf-8') as output:
        output.write(example)
    destination.chmod(0o600)
    print('Created .env with a new JWT secret.')


if __name__ == '__main__':
    main()
