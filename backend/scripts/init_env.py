from pathlib import Path
from secrets import token_urlsafe


def main():
    project = Path(__file__).resolve().parents[1]
    destination = project / '.env'
    if destination.exists():
        # Preserve secrets/user choices; append only missing integration settings.
        from dotenv import dotenv_values
        values = dotenv_values(destination)
        defaults = dotenv_values(project / '.env.example')
        keys = ('DLI_CALLABLE', 'DIRECTION_CALLABLE', 'RECOMMENDATION_CALLABLE', 'DLI_CACHE_VERSION')
        missing = [key for key in keys if key not in values]
        if missing:
            with destination.open('a', encoding='utf-8') as output:
                output.write('\n# Added integration settings\n')
                for key in missing:
                    output.write(f'{key}={defaults[key]}\n')
        print('Existing .env preserved; missing integration settings added. Restart server.')
        return
    example = (project / '.env.example').read_text(encoding='utf-8')
    example = example.replace('replace-with-a-random-secret-at-least-32-characters',token_urlsafe(48))
    with destination.open('x',encoding='utf-8') as output:
        output.write(example)
    destination.chmod(0o600)
    print('Created .env with a new JWT secret.')


if __name__ == '__main__':
    main()
