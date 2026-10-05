# Referências das galáxias

Este documento registra **quais imagens de referência foram usadas, o que elas mostram, como cada objeto foi identificado e para que serviram** no Galaxy Explorer.

> **Nenhuma imagem de referência faz parte do repositório nem aparece na cena.** Todas as galáxias são geradas proceduralmente em 3D (estrelas, luz difusa integrada em volume, poeira, mapas gerados na GPU). As imagens serviram apenas como referência visual de forma, cor e estrutura. Elas foram enviadas pelo usuário durante o desenvolvimento e **não foram copiadas** para o projeto: várias têm direitos autorais de terceiros ou origem desconhecida.

## Imagens enviadas

| Arquivo | Objeto | Tipo | Como foi identificado / validado | Uso no projeto |
| --- | --- | --- | --- | --- |
| `1.webp` | M31, Andrômeda (com M32 e M110) | Espiral | Forma, inclinação e posição das satélites; fotografia de céu profundo de origem não informada | Cor, inclinação e proporção bojo/disco de M31 |
| `2.jpg` | M31, Andrômeda | Espiral | Mesmas feições; traz a marca **BBC News Brasil** (direitos de terceiros) | Apenas referência visual de faixas de poeira e anel azul |
| `3.webp` | M31 no ultravioleta (GALEX) | Espiral | Anéis azuis granulados característicos do GALEX, M32 alaranjada | Anel de formação estelar (~10 kpc) e aglomerados azuis |
| `4.jpg` | M31, Andrômeda | Espiral | Mesmas feições; origem não informada | Cores do bojo e das satélites |
| `5.jpg` | M31, Andrômeda | Espiral | Mesmas feições, enquadramento vertical; origem não informada | Enquadramento em telas verticais |
| `6.jpg`, `20.jpg` | M64, Galáxia do Olho Negro | Espiral | Faixa escura de poeira diante do núcleo brilhante; conferido com o catálogo Messier da NASA | Anel de poeira assimétrico perto do núcleo, disco externo liso |
| `7.jpg`, `19.jpg` | M104, Galáxia do Sombreiro | Espiral vista quase de perfil | Bojo enorme e faixa de poeira no disco; conferido com o catálogo Messier da NASA | Bojo em camadas, anel de poeira, inclinação quase de perfil |
| `8.jpg` | Arp 87 (NGC 3808 e NGC 3808A) | Par em interação | Espiral de frente ligada por uma ponte de matéria a uma companheira de perfil; confirmado pelo atlas Arp e pelo NED | Ponte/braço envolvendo a companheira, disco de perfil |
| `9.jpg` | M83, Cata-vento do Sul | Espiral barrada | Barra central, braços com muitas regiões HII; conferido com o catálogo Messier da NASA | Barra, braços a partir das pontas, regiões HII |
| `10.jpg` | M31 no ultravioleta (GALEX) | Espiral | Mesma imagem de `3.webp` | — (repetida) |
| `11.jpg` | NGC 4414 | Espiral (floculenta) | Disco sem braços longos, muitos fragmentos curtos; conferido com ESA/Hubble opo9925a | Modo floculento do mapa procedural |
| `12.jpg` | NGC 1300 | Espiral barrada | Barra longa com faixas de poeira retas e dois braços; conferido com ESA/Hubble opo0501a | Barra longa, poeira na borda de ataque, braços abertos |
| `13.jpg` | NGC 1566 (Webb × Hubble) | Espiral | Comparação infravermelho/visível do programa PHANGS; conferido com ESA/Webb weic2403j | Dois braços dominantes com poeira e aglomerados |
| `14.jpg` | NGC 474 (com NGC 470) | Galáxia com conchas | Esferoide cercado de conchas e laços tênues, espiral ao lado; conferido no NED (par Arp 227) | Conchas estelares e companheira espiral |
| `15.jpg` | Centaurus A (NGC 5128) | Elíptica peculiar | Elíptica gigante com faixa de poeira torcida; conferido com ESO eso0903a | Esferoide gigante e disco de poeira empenado |
| `16.jpg` | Arp 142 (NGC 2936 e NGC 2937), "Pinguim" | Par em interação | Espiral deformada em forma de pinguim e elíptica (o "ovo"); conferido com ESA/Hubble heic1311a | Disco deformado por maré, elíptica compacta, corrente |
| `17.jpg` | Galáxias Antenas (NGC 4038 e NGC 4039) | Par em fusão | Dois núcleos, poeira caótica, muitas regiões HII; conferido com ESA/Hubble heic0812 | Dois discos deformados, região de contato, caudas de maré |
| `18.jpg` | — | **Arte digital (aparenta ser gerada por IA)** | Cores saturadas e nebulosidade sem correspondência com fotografias astronômicas | Nenhum uso estrutural; no máximo referência de clima |
| `21.jpg` | M31 em composição de vários comprimentos de onda | Espiral | Forma de M31 com cores falsas (infravermelho em vermelho); fonte exata não identificada | Nenhum uso direto (não representa a cor visível) |
| `22.jpg` | Objeto de Hoag | Galáxia anelar | Anel azul quase perfeito em volta de núcleo amarelo; conferido com ESA/Hubble opo0221a | Anel 3D irregular, intervalo escuro, núcleo esferoidal |

O vídeo enviado (gravação de tela de um vídeo de galáxias) também foi apenas inspiração de experiência: voo entre galáxias e sensação de escala. Nenhum quadro dele foi usado.

## Fontes dos dados científicos

Os valores mostrados no cartão de informação de cada galáxia vêm destas fontes (consultadas durante o desenvolvimento):

| Galáxia | Distância usada | Constelação | Fonte |
| --- | --- | --- | --- |
| M31 | ≈ 2,5 milhões de anos-luz | Andrômeda | [NASA Hubble Messier Catalog: M31](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-31/) |
| M104 | ≈ 28 milhões de anos-luz | Virgem | [NASA Hubble Messier Catalog: M104](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-104/) |
| M64 | ≈ 17 milhões de anos-luz | Cabeleira de Berenice | [NASA Hubble Messier Catalog: M64](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-64/) |
| M83 | ≈ 15 milhões de anos-luz | Hidra | [NASA Hubble Messier Catalog: M83](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-83/) |
| NGC 1300 | ≈ 60 milhões de anos-luz | Erídano | [ESA/Hubble opo0501a](https://esahubble.org/images/opo0501a/) |
| NGC 1566 | ≈ 60 milhões de anos-luz | Dourado | [ESA/Webb weic2403j](https://esawebb.org/images/weic2403j/) |
| NGC 4414 | ≈ 60 milhões de anos-luz | Cabeleira de Berenice | [ESA/Hubble opo9925a](https://esahubble.org/images/opo9925a/) |
| Objeto de Hoag | ≈ 550 milhões de anos-luz; ≈ 120 mil anos-luz de diâmetro | Serpente (Cabeça) | [ESA/Hubble opo0221a](https://esahubble.org/images/opo0221a/) |
| Centaurus A | ≈ 13 milhões de anos-luz | Centauro | [ESO eso0903a](https://www.eso.org/public/images/eso0903a/) |
| Antenas | ≈ 45 milhões de anos-luz (estimativa revisada em 2008) | Corvo | [ESA/Hubble heic0812](https://esahubble.org/images/heic0812a/) |
| Arp 142 | ≈ 400 milhões de anos-luz | Hidra | [ESA/Hubble heic1311a](https://esahubble.org/images/heic1311a/) |
| NGC 474 / NGC 470 | ≈ 110 milhões de anos-luz — **estimativa** pelo desvio para o vermelho (z = 0,0077; H₀ = 70 km/s/Mpc) | Peixes | [NED](https://ned.ipac.caltech.edu/) |
| Arp 87 | ≈ 330 milhões de anos-luz — **estimativa** pelo desvio para o vermelho (z = 0,0236; H₀ = 70 km/s/Mpc) | Leão | [NED](https://ned.ipac.caltech.edu/) |

As **coordenadas celestes** (ascensão reta e declinação) de todos os objetos foram obtidas no [NASA/IPAC Extragalactic Database (NED)](https://ned.ipac.caltech.edu/) e definem a direção de cada galáxia no explorador.

Distâncias astronômicas têm incertezas e mudam com novas medições; os números acima são os publicados pelas fontes citadas no momento da consulta. Quando a fonte não traz uma distância medida, o explorador mostra a estimativa e diz que é uma estimativa.

## O que é ciência e o que é visualização

| Ciência (dados verificados) | Visualização (escolhas artísticas) |
| --- | --- |
| Nome, designações de catálogo, tipo, constelação | Número de estrelas, cores, brilho, ruído procedural |
| Distância (medida ou estimada, conforme a fonte) | Distâncias **comprimidas** entre as galáxias (escala logarítmica) |
| Direção no céu (RA/Dec do NED) | Tamanho na cena (algumas galáxias pequenas foram ampliadas) |
| Tamanho do Objeto de Hoag (fonte ESA) | Orientação aproximada pela aparência nas fotos (não é medida) |
| | Rotação lenta e visual (não é uma simulação gravitacional) |
| | Sistemas em interação congelados em um estado visual representativo |

## Créditos das imagens citadas

As imagens citadas acima pertencem aos seus autores e instituições (NASA, ESA/Hubble, ESA/Webb, ESO e autores não identificados). Elas **não são distribuídas** com este projeto. Para ver as fotografias originais, use os links da tabela de fontes; ao reutilizá-las, siga as regras de crédito de cada instituição (por exemplo, ESA/Hubble exige o crédito completo visível).
